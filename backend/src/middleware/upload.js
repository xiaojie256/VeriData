const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const UPLOAD_PATH = process.env.UPLOAD_PATH || './uploads';

// 确保上传目录存在
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// Magic bytes 签名表：用文件头校验真实类型，防止伪造后缀逃逸
const MIME_SIGNATURES = {
  // images
  '.jpg':  [[0xFF, 0xD8, 0xFF]],
  '.jpeg': [[0xFF, 0xD8, 0xFF]],
  '.png':  [[0x89, 0x50, 0x4E, 0x47]],
  '.gif':  [[0x47, 0x49, 0x46, 0x38]],
  // office
  '.xlsx': [[0x50, 0x4B, 0x03, 0x04]],  // ZIP-based
  '.xls':  [[0xD0, 0xCF, 0x11, 0xE0]],
  '.doc':  [[0xD0, 0xCF, 0x11, 0xE0]],
  '.docx': [[0x50, 0x4B, 0x03, 0x04]],  // ZIP-based
  // archive
  '.zip':  [[0x50, 0x4B, 0x03, 0x04]],
  '.rar':  [[0x52, 0x61, 0x72, 0x21]],
  // text-based (content starts with valid chars, just verify it's not binary garbage)
  '.csv':  null, '.json': null, '.txt': null, '.pdf': null
};

// 需要校验 magic bytes 的扩展名（文本格式无法通过文件头校验，跳过）
const SKIP_MAGIC_CHECK = new Set(['.csv', '.json', '.txt', '.pdf']);

// 读取文件头并与签名表比对
const validateMagicBytes = (filePath, ext) => {
  if (SKIP_MAGIC_CHECK.has(ext)) return true;
  const signatures = MIME_SIGNATURES[ext];
  if (!signatures) return false;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return signatures.some(sig => sig.every((byte, i) => buf[i] === byte));
  } catch {
    return false;
  }
};

// 存储配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subDir = req.uploadType === 'avatar' ? 'avatars' : req.uploadType === 'id-card' ? 'id-cards' : 'data';
    const destPath = path.join(UPLOAD_PATH, subDir);
    ensureDir(destPath);
    cb(null, destPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = crypto.randomUUID();
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${uniqueSuffix}${ext}`);
  }
});

// 文件过滤器：先校验扩展名，落盘后再校验 magic bytes
const fileFilter = (req, file, cb) => {
  const allowedTypes = {
    'data': ['.csv', '.xlsx', '.xls', '.json', '.txt', '.pdf', '.doc', '.docx', '.zip', '.rar'],
    'avatar': ['.jpg', '.jpeg', '.png', '.gif'],
    'id-card': ['.jpg', '.jpeg', '.png']
  };

  const type = req.uploadType || 'data';
  const ext = path.extname(file.originalname).toLowerCase();

  if (!allowedTypes[type] || !allowedTypes[type].includes(ext)) {
    return cb(new Error(`不支持的文件类型: ${ext}，允许的类型: ${allowedTypes[type]?.join(', ')}`), false);
  }

  // 对文本格式跳过 magic bytes 校验（无法可靠检测）
  if (SKIP_MAGIC_CHECK.has(ext)) return cb(null, true);

  // 先让 multer 落盘，再在后置中间件中校验 magic bytes
  cb(null, true);
};

// 上传配置
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024 // 默认100MB
  }
});

// 错误处理
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '文件大小超出限制' });
    }
    return res.status(400).json({ error: `上传错误: ${err.message}` });
  }

  if (err) {
    return res.status(400).json({ error: err.message });
  }

  next();
};

// 后置 magic bytes 校验：文件已落盘后校验真实内容，防止伪造后缀绕过
const verifyFileIntegrity = (req, res, next) => {
  if (!req.file) return next();

  const ext = path.extname(req.file.originalname).toLowerCase();
  if (SKIP_MAGIC_CHECK.has(ext)) return next();

  if (!validateMagicBytes(req.file.path, ext)) {
    // 删除伪造文件
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: `文件内容与后缀 ${ext} 不匹配，疑似伪造文件` });
  }

  next();
};

module.exports = { upload, handleUploadError, verifyFileIntegrity };

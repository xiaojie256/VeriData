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

// 文件过滤器
const fileFilter = (req, file, cb) => {
  const allowedTypes = {
    'data': ['.csv', '.xlsx', '.xls', '.json', '.txt', '.pdf', '.doc', '.docx', '.zip', '.rar'],
    'avatar': ['.jpg', '.jpeg', '.png', '.gif'],
    'id-card': ['.jpg', '.jpeg', '.png']
  };
  
  const type = req.uploadType || 'data';
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedTypes[type] && allowedTypes[type].includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的文件类型: ${ext}，允许的类型: ${allowedTypes[type]?.join(', ')}`), false);
  }
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

module.exports = { upload, handleUploadError };

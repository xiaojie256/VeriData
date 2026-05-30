/**
 * 环境变量验证
 * 确保所有必需的环境变量都已设置且格式正确
 */

const REQUIRED_ENV_VARS = [
  { name: 'JWT_SECRET', minLength: 32, description: 'JWT签名密钥，至少32个字符' },
  { name: 'DB_PASSWORD', minLength: 8, description: '数据库密码' },
];

const OPTIONAL_ENV_VARS = [
  { name: 'NODE_ENV', allowed: ['development', 'production', 'test'], default: 'development' },
  { name: 'PORT', type: 'number', default: 3000 },
  { name: 'DB_HOST', default: 'localhost' },
  { name: 'DB_PORT', type: 'number', default: 3306 },
  { name: 'REDIS_HOST', default: 'localhost' },
  { name: 'REDIS_PORT', type: 'number', default: 6379 },
];

/**
 * 验证环境变量
 * @throws {Error} 验证失败时抛出错误
 */
function validateEnv() {
  const errors = [];
  
  // 验证必需变量
  for (const envVar of REQUIRED_ENV_VARS) {
    const value = process.env[envVar.name];
    
    if (!value) {
      errors.push(`缺少必需的环境变量: ${envVar.name} (${envVar.description})`);
      continue;
    }
    
    if (envVar.minLength && value.length < envVar.minLength) {
      errors.push(`${envVar.name} 长度必须至少 ${envVar.minLength} 个字符`);
    }
    
    // 检查是否使用了默认值（安全风险）
    const defaultValues = [
      'your-secret-key',
      'secret',
      'password',
      '123456',
      'admin',
      'VeriData_JWT_Secret_Key_2024_Secure_Random_String'
    ];
    
    if (defaultValues.includes(value)) {
      errors.push(`${envVar.name} 使用了不安全的默认值`);
    }
  }
  
  // 验证可选变量类型
  for (const envVar of OPTIONAL_ENV_VARS) {
    const value = process.env[envVar.name];
    
    if (value && envVar.type === 'number') {
      const numValue = parseInt(value, 10);
      if (isNaN(numValue)) {
        errors.push(`${envVar.name} 必须是数字`);
      }
    }
    
    if (value && envVar.allowed && !envVar.allowed.includes(value)) {
      errors.push(`${envVar.name} 必须是以下之一: ${envVar.allowed.join(', ')}`);
    }
  }
  
  // 生产环境特殊检查
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.DB_PASSWORD || process.env.DB_PASSWORD.length < 12) {
      errors.push('生产环境数据库密码必须至少12个字符');
    }
    
    if (process.env.CORS_ORIGIN === '*') {
      errors.push('生产环境不允许 CORS 设置为 *');
    }
  }
  
  if (errors.length > 0) {
    console.error('\n❌ 环境变量验证失败:');
    errors.forEach(error => console.error(`   - ${error}`));
    console.error('\n请检查 .env 文件或环境变量设置。\n');
    process.exit(1);
  }
  
  console.log('✅ 环境变量验证通过\n');
}

module.exports = { validateEnv };

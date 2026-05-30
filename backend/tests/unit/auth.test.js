const request = require('supertest');
const app = require('../../src/app');
const pool = require('../../src/utils/database');

describe('Auth Routes', () => {
  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'testpass123',
          real_name: 'Test User',
          role: 'student'
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('token');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user.username).toBe('testuser');
    });

    it('should reject registration with invalid email', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'testuser2',
          email: 'invalid-email',
          password: 'testpass123',
          role: 'student'
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should reject registration with short password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'testuser3',
          email: 'test3@example.com',
          password: '123',
          role: 'student'
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should reject duplicate username', async () => {
      // 先注册一个用户
      await request(app)
        .post('/api/auth/register')
        .send({
          username: 'duplicateuser',
          email: 'dup@example.com',
          password: 'testpass123',
          role: 'student'
        });

      // 尝试重复注册
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'duplicateuser',
          email: 'dup2@example.com',
          password: 'testpass123',
          role: 'student'
        });

      expect(response.status).toBe(409);
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      // 创建测试用户
      await request(app)
        .post('/api/auth/register')
        .send({
          username: 'logintest',
          email: 'login@example.com',
          password: 'testpass123',
          role: 'student'
        });
    });

    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          account: 'logintest',
          password: 'testpass123'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
      expect(response.body.user).toHaveProperty('role');
    });

    it('should reject invalid password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          account: 'logintest',
          password: 'wrongpassword'
        });

      expect(response.status).toBe(401);
    });

    it('should lock account after 5 failed attempts', async () => {
      // 连续失败5次
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({
            account: 'logintest',
            password: 'wrongpassword'
          });
      }

      // 第6次应该被锁定
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          account: 'logintest',
          password: 'testpass123'
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('锁定');
    });
  });

  describe('GET /api/auth/me', () => {
    let token;

    beforeEach(async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'metest',
          email: 'me@example.com',
          password: 'testpass123',
          role: 'student'
        });
      token = response.body.token;
    });

    it('should return user info with valid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.user).toHaveProperty('username');
      expect(response.body.user.username).toBe('metest');
    });

    it('should reject request without token', async () => {
      const response = await request(app)
        .get('/api/auth/me');

      expect(response.status).toBe(401);
    });

    it('should reject expired token', async () => {
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImlhdCI6MTUwMDAwMDAwMCwiZXhwIjoxNTAwMDAwMDAwfQ.invalid';
      
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(response.status).toBe(401);
    });
  });
});

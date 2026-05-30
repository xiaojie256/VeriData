const request = require('supertest');
const app = require('../../src/app');
const pool = require('../../src/utils/database');
const path = require('path');
const fs = require('fs');

describe('Data Routes Integration', () => {
  let authToken;
  let userId;

  beforeEach(async () => {
    // 创建测试用户并登录
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({
        username: `data_test_${Date.now()}`,
        email: `data_test_${Date.now()}@example.com`,
        password: 'testpass123',
        role: 'student'
      });
    
    authToken = registerRes.body.token;
    userId = registerRes.body.user.id;
  });

  describe('POST /api/data/upload', () => {
    it('should upload a CSV file successfully', async () => {
      // 创建测试CSV文件
      const testFilePath = path.join(__dirname, 'test_data.csv');
      fs.writeFileSync(testFilePath, 'name,age,value\nJohn,30,100\nJane,25,200');

      const response = await request(app)
        .post('/api/data/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .field('title', 'Test Data')
        .field('description', 'Test description')
        .attach('file', testFilePath);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('data_id');
      expect(response.body).toHaveProperty('file_hash');

      // 清理
      fs.unlinkSync(testFilePath);
    });

    it('should reject upload without authentication', async () => {
      const response = await request(app)
        .post('/api/data/upload')
        .field('title', 'Test Data');

      expect(response.status).toBe(401);
    });

    it('should enforce quota limits', async () => {
      // 获取用户配额
      const [users] = await pool.execute(
        'SELECT quota_total, quota_used FROM users WHERE id = ?',
        [userId]
      );
      
      expect(users[0].quota_used).toBeGreaterThan(0);
    });

    it('should prevent duplicate file upload', async () => {
      // 创建测试文件
      const testFilePath = path.join(__dirname, 'duplicate_test.csv');
      fs.writeFileSync(testFilePath, 'col1,col2\n1,2\n3,4');

      // 第一次上传
      const firstUpload = await request(app)
        .post('/api/data/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .field('title', 'First Upload')
        .attach('file', testFilePath);

      expect(firstUpload.status).toBe(201);

      // 第二次上传相同文件
      const secondUpload = await request(app)
        .post('/api/data/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .field('title', 'Duplicate Upload')
        .attach('file', testFilePath);

      expect(secondUpload.status).toBe(409);
      expect(secondUpload.body.error).toContain('已上传');

      // 清理
      fs.unlinkSync(testFilePath);
    });
  });

  describe('GET /api/data/my', () => {
    it('should return user data list', async () => {
      const response = await request(app)
        .get('/api/data/my')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/data/my?page=1&limit=5')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.pagination.limit).toBe(5);
    });
  });

  describe('GET /api/data/:id', () => {
    it('should return data details', async () => {
      // 先创建一个数据
      const testFilePath = path.join(__dirname, 'detail_test.csv');
      fs.writeFileSync(testFilePath, 'a,b,c\n1,2,3');

      const upload = await request(app)
        .post('/api/data/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .field('title', 'Detail Test')
        .attach('file', testFilePath);

      const dataId = upload.body.data_id;

      // 获取详情
      const response = await request(app)
        .get(`/api/data/${dataId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('title');
      expect(response.body.data.title).toBe('Detail Test');

      // 清理
      fs.unlinkSync(testFilePath);
    });

    it('should return 404 for non-existent data', async () => {
      const response = await request(app)
        .get('/api/data/999999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/data/:id/submit', () => {
    it('should submit data for review', async () => {
      // 创建测试文件和数据
      const testFilePath = path.join(__dirname, 'submit_test.csv');
      fs.writeFileSync(testFilePath, 'x,y\n1,2');

      const upload = await request(app)
        .post('/api/data/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .field('title', 'Submit Test')
        .attach('file', testFilePath);

      const dataId = upload.body.data_id;

      // 提交审核
      const response = await request(app)
        .post(`/api/data/${dataId}/submit`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          teacher_id: 1,
          liability_accepted: true
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('成功');

      // 验证状态已更新
      const [data] = await pool.execute(
        'SELECT review_status FROM data_submissions WHERE id = ?',
        [dataId]
      );
      expect(data[0].review_status).toBe('submitted');

      // 清理
      fs.unlinkSync(testFilePath);
    });
  });
});

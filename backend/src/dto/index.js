/**
 * 数据传输对象 (DTO)
 * 定义统一的请求/响应格式，隐藏敏感字段
 */

// 用户DTO
const UserDTO = {
  // 响应时排除敏感字段
  toResponse(user) {
    if (!user) return null;
    
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      real_name: user.real_name,
      avatar_url: user.avatar_url,
      role: user.role,
      status: user.status,
      quota_total: user.quota_total,
      quota_used: user.quota_used,
      email_verified: user.email_verified,
      phone_verified: user.phone_verified,
      id_verified: user.id_verified,
      created_at: user.created_at,
      last_login_at: user.last_login_at
      // 排除: password_hash, id_card_number, login_fail_count, locked_until等
    };
  },
  
  // 列表响应（简化版）
  toListResponse(user) {
    if (!user) return null;
    
    return {
      id: user.id,
      username: user.username,
      real_name: user.real_name,
      role: user.role,
      status: user.status,
      last_login_at: user.last_login_at
    };
  }
};

// 数据提交DTO
const DataSubmissionDTO = {
  toResponse(data, userRole = null) {
    if (!data) return null;
    
    const response = {
      id: data.id,
      title: data.title,
      description: data.description,
      data_type: data.data_type,
      data_format: data.data_format,
      file_size: data.file_size,
      visibility: data.visibility,
      review_status: data.review_status,
      review_progress: data.review_progress,
      ai_check_status: data.ai_check_status,
      ai_check_score: data.ai_check_score,
      ai_anomaly_detected: data.ai_anomaly_detected,
      version: data.version,
      citation_count: data.citation_count,
      download_count: data.download_count,
      created_at: data.created_at,
      submitted_at: data.submitted_at,
      completed_at: data.completed_at,
      is_liability_accepted: data.is_liability_accepted
    };
    
    // 盲审模式：专家审核中隐藏提交者信息
    if (data.review_status === 'expert_reviewing' && userRole === 'expert') {
      response.submitter = { blinded: true };
    } else {
      response.submitter = {
        id: data.submitter_id,
        username: data.submitter_name,
        real_name: data.submitter_real_name
      };
    }
    
    return response;
  }
};

// 审核记录DTO
const ReviewRecordDTO = {
  toResponse(record) {
    if (!record) return null;
    
    return {
      id: record.id,
      data_id: record.data_id,
      review_type: record.review_type,
      status: record.status,
      scores: {
        completeness: record.completeness_score,
        accuracy: record.accuracy_score,
        originality: record.originality_score,
        methodology: record.methodology_score,
        overall: record.overall_score
      },
      comments: record.comments,
      suggestions: record.suggestions,
      ai_assisted: record.ai_assisted,
      created_at: record.created_at,
      completed_at: record.completed_at
      // 盲审时 reviewer_id 已在查询时处理
    };
  }
};

// 统一API响应格式
const ApiResponse = {
  success(data, message = null) {
    return {
      success: true,
      data,
      message,
      timestamp: new Date().toISOString()
    };
  },
  
  error(message, code = null, details = null) {
    return {
      success: false,
      error: {
        message,
        code,
        details
      },
      timestamp: new Date().toISOString()
    };
  },
  
  paginated(data, pagination) {
    return {
      success: true,
      data,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        totalPages: Math.ceil(pagination.total / pagination.limit)
      },
      timestamp: new Date().toISOString()
    };
  }
};

module.exports = {
  UserDTO,
  DataSubmissionDTO,
  ReviewRecordDTO,
  ApiResponse
};

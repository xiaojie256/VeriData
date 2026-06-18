const PUBLIC_REVIEW_STATUSES = ['final_approved'];
const LIMITED_REVIEW_STATUSES = ['final_approved'];

const normalizeUserIdList = (value) => {
  if (!value) return [];

  let parsed = value;

  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = value.split(',');
    }
  }

  if (!Array.isArray(parsed)) return [];

  return [...new Set(
    parsed
      .map((item) => Number.parseInt(item, 10))
      .filter((item) => Number.isSafeInteger(item) && item > 0)
  )];
};

const isTeacherOfSubmitter = async (db, teacherId, submitterId) => {
  const [relations] = await db.execute(
    `SELECT id
     FROM teacher_student_relations
     WHERE teacher_id = ?
       AND student_id = ?
       AND status = 'active'
     LIMIT 1`,
    [teacherId, submitterId]
  );

  return relations.length > 0;
};

const canReviewData = async (db, user, data) => {
  if (!user || !data) return false;

  if (user.role === 'admin') return true;

  if (Number(data.submitter_id) === Number(user.id)) return true;

  const [reviews] = await db.execute(
    `SELECT id
     FROM review_records
     WHERE data_id = ?
       AND status = 'pending'
       AND review_type = ?
       AND (reviewer_id = ? OR reviewer_id IS NULL)
     LIMIT 1`,
    [data.id, user.role, user.id]
  );

  if (reviews.length > 0) return true;

  if (user.role === 'teacher') {
    return isTeacherOfSubmitter(db, user.id, data.submitter_id);
  }

  return false;
};

const canAccessData = async (db, user, data) => {
  if (!data) return false;

  if (
    data.visibility === 'public' &&
    PUBLIC_REVIEW_STATUSES.includes(data.review_status)
  ) {
    return true;
  }

  if (!user) return false;

  if (await canReviewData(db, user, data)) {
    return true;
  }

  if (
    data.visibility === 'limited' &&
    LIMITED_REVIEW_STATUSES.includes(data.review_status)
  ) {
    const allowedUserIds = normalizeUserIdList(data.view_permission);
    return allowedUserIds.includes(Number(user.id));
  }

  return false;
};

module.exports = {
  PUBLIC_REVIEW_STATUSES,
  LIMITED_REVIEW_STATUSES,
  normalizeUserIdList,
  isTeacherOfSubmitter,
  canReviewData,
  canAccessData
};

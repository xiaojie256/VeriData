const pool = require('../src/utils/database');
const { normalizeOriginalFilename } = require('../src/utils/filename');

const main = async () => {
  const [rows] = await pool.execute(
    `SELECT id, title, original_filename
     FROM data_submissions
     WHERE deleted_at IS NULL`
  );

  let fixedCount = 0;

  for (const row of rows) {
    const fixedFilename = normalizeOriginalFilename(row.original_filename);

    if (fixedFilename && fixedFilename !== row.original_filename) {
      const nextTitle =
        !row.title || row.title === row.original_filename
          ? fixedFilename
          : row.title;

      await pool.execute(
        `UPDATE data_submissions
         SET original_filename = ?, title = ?
         WHERE id = ?`,
        [fixedFilename, nextTitle, row.id]
      );

      fixedCount += 1;
      console.log(`已修复 data_id=${row.id}: ${row.original_filename} -> ${fixedFilename}`);
    }
  }

  console.log(`修复完成，共修复 ${fixedCount} 条记录`);
};

main()
  .catch((error) => {
    console.error('修复文件名失败:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

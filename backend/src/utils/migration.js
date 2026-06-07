const fs = require("fs");
const path = require("path");
const pool = require("./database");
const logger = require("./logger");

async function runMigrations() {
  const migrationsDir = path.join(__dirname, "..", "migrations");

  await pool.execute(
    "CREATE TABLE IF NOT EXISTS _migrations (" +
    "id INT AUTO_INCREMENT PRIMARY KEY," +
    "filename VARCHAR(255) NOT NULL UNIQUE," +
    "applied_at DATETIME DEFAULT CURRENT_TIMESTAMP" +
    ")"
  );

  const [applied] = await pool.execute("SELECT filename FROM _migrations");
  const appliedSet = new Set(applied.map((r) => r.filename));

  let files;
  try {
    files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch (err) {
    logger.info("No migrations directory found, skipping.");
    return;
  }

  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8").trim();
    if (!sql) continue;

    logger.info("Running migration: " + file);
    try {
      const statements = sql.split(/;\s*\n/).filter((s) => s.trim());
      for (const stmt of statements) {
        await pool.execute(stmt);
      }
      await pool.execute("INSERT INTO _migrations (filename) VALUES (?)", [file]);
      logger.info("Migration completed: " + file);
    } catch (err) {
      if (err.code === "ER_DUP_FIELDNAME") {
        logger.info("Migration " + file + ": column already correct, skipping.");
        await pool.execute("INSERT INTO _migrations (filename) VALUES (?)", [file]);
      } else {
        logger.error("Migration " + file + " failed: " + err.message);
      }
    }
  }
}

module.exports = { runMigrations };

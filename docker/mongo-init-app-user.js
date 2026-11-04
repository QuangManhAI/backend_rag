// Runs once, on an empty data directory: the account the app uses, limited to its own database.
db.getSiblingDB('admin').createUser({
  user: process.env.RAGTS_MONGO_APP_USER,
  pwd: process.env.RAGTS_MONGO_APP_PASSWORD,
  roles: [{ role: 'readWrite', db: 'rag_ts' }],
});

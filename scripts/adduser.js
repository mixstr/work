'use strict';

// Add (or update the password of) a user account.
//   node scripts/adduser.js <username> <password>
// Passwords are stored hashed (scrypt). Re-running with an existing
// username updates that user's password.

const { addUser, DB_PATH } = require('../server/db');

const [, , username, password] = process.argv;

if (!username || !password) {
  console.error('Использование: node scripts/adduser.js <логин> <пароль>');
  process.exit(1);
}

try {
  const res = addUser(username, password);
  console.log(
    `${res.updated ? 'Обновлён' : 'Создан'} пользователь "${res.username}"`,
  );
  console.log(`БД: ${DB_PATH}`);
} catch (err) {
  console.error('Ошибка:', err.message);
  process.exit(1);
}

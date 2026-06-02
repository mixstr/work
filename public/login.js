'use strict';

const form = document.getElementById('loginForm');
const errEl = document.getElementById('loginError');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errEl.textContent = '';
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  if (!username || !password) { errEl.textContent = 'Введите логин и пароль'; return; }

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      location.href = '/';
    } else {
      errEl.textContent = data.error || 'Ошибка входа';
    }
  } catch {
    errEl.textContent = 'Сеть недоступна, попробуйте ещё раз';
  }
});

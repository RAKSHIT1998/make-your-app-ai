const root = document.getElementById('app');
const state = { mode: 'signin', tasks: [], loading: false, error: '' };

function el(tag, props, children) {
  const n = document.createElement(tag);
  Object.assign(n, props || {});
  (children || []).forEach((c) => n.append(c));
  return n;
}

function authView() {
  const signup = state.mode === 'signup';
  const email = el('input', { type: 'email', required: true, autocomplete: 'email', id: 'email' });
  const password = el('input', { type: 'password', required: true, minLength: 8, autocomplete: signup ? 'new-password' : 'current-password', id: 'password' });
  const error = el('p', { className: 'error', role: 'alert' });
  const submit = el('button', { className: 'primary', type: 'submit', textContent: signup ? 'Create account' : 'Sign in' });
  const form = el('form', {}, [
    el('label', { htmlFor: 'email' }, ['Email', email]),
    el('label', { htmlFor: 'password' }, [signup ? 'Password (8+ characters)' : 'Password', password]),
    error, submit,
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true; error.textContent = '';
    try {
      if (signup) await App.auth.signUp(email.value, password.value);
      else await App.auth.signIn(email.value, password.value);
    } catch (err) {
      error.textContent = err.message; submit.disabled = false;
    }
  });
  const toggle = el('button', { type: 'button', className: 'link', textContent: signup ? 'I already have an account' : 'New here? Create an account' });
  toggle.addEventListener('click', () => { state.mode = signup ? 'signin' : 'signup'; render(); });
  return el('div', { className: 'card' }, [el('h1', { textContent: 'Taskly' }), el('p', { className: 'muted', textContent: 'Your tasks, saved to your account.' }), form, toggle]);
}

function taskItem(t) {
  const box = el('input', { type: 'checkbox', checked: !!t.done });
  box.setAttribute('aria-label', 'Mark "' + t.title + '" done');
  box.addEventListener('change', () => mutate(() => App.db.update('tasks', t.id, { done: box.checked })));
  const del = el('button', { className: 'del', type: 'button', textContent: 'Delete' });
  del.setAttribute('aria-label', 'Delete "' + t.title + '"');
  del.addEventListener('click', () => mutate(() => App.db.remove('tasks', t.id)));
  const kids = [box, el('span', { className: 'title', textContent: t.title })];
  if (t.priority && t.priority !== 'normal') kids.push(el('span', { className: 'tag ' + t.priority, textContent: t.priority }));
  kids.push(del);
  return el('li', { className: t.done ? 'done' : '' }, kids);
}

function tasksView(user) {
  const out = el('button', { type: 'button', textContent: 'Sign out' });
  out.addEventListener('click', () => App.auth.signOut());
  const title = el('input', { required: true, maxLength: 120, placeholder: 'What needs doing?', id: 'new-task' });
  title.setAttribute('aria-label', 'New task');
  const priority = el('select', {}, ['normal', 'high', 'low'].map((p) => el('option', { value: p, textContent: p })));
  priority.setAttribute('aria-label', 'Priority');
  const add = el('button', { className: 'primary', type: 'submit', textContent: 'Add', disabled: state.loading });
  const form = el('form', {}, [el('div', { className: 'row' }, [title, priority, add])]);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = title.value.trim();
    if (!value) return;
    mutate(() => App.db.create('tasks', { title: value, done: false, priority: priority.value }));
  });
  const list = state.tasks.length
    ? el('ul', {}, state.tasks.map(taskItem))
    : el('p', { className: 'muted', textContent: state.loading ? 'Loading your tasks…' : 'No tasks yet. Add your first one above.' });
  const left = state.tasks.filter((t) => !t.done).length;
  return el('div', {}, [
    el('div', { className: 'bar' }, [el('div', {}, [el('h1', { textContent: 'My tasks' }), el('p', { className: 'muted', textContent: user.email + ' · ' + left + ' open' })]), out]),
    form, el('p', { className: 'error', role: 'alert', textContent: state.error }), list,
  ]);
}

async function load() {
  state.loading = true; state.error = ''; render();
  try {
    const res = await App.db.list('tasks', { mine: true, limit: 100 });
    state.tasks = res.items;
  } catch (err) {
    state.error = err.message;
  }
  state.loading = false; render();
}

async function mutate(fn) {
  state.error = '';
  try { await fn(); } catch (err) { state.error = err.message; }
  await load();
}

function render() {
  const user = App.auth.user();
  root.textContent = '';
  root.append(user ? tasksView(user) : authView());
}

App.auth.onChange((user) => { state.tasks = []; if (user) load(); else { state.mode = 'signin'; render(); } });
App.ready.then(render);

import type { OfficeApi } from '../api';
import { button, el } from '../dom';
import { agentName, ROLE_LABELS } from '../labels';
import { memoryKey, type Store } from '../store';
import { relativeTime } from '../time';
import type { FloorKind, LessonView, MemoryView, ReportView, RoleId } from '../types';

const MEMORY_KINDS: ReadonlySet<FloorKind> = new Set<FloorKind>(['managed', 'direccion', 'redaccion', 'mantenimiento']);
const REPORT_LIMIT = 50;
const LESSON_MAX_CHARS = 500;
const DATE_FORMAT = new Intl.DateTimeFormat('es', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

type Target = { floor: string; role: RoleId };

function reportItem(report: ReportView): HTMLElement {
  return el(
    'li',
    'history-item',
    el(
      'div',
      'history-head',
      el('span', 'history-date muted', DATE_FORMAT.format(report.endedAt ?? report.startedAt)),
      el('span', 'history-name', report.name || report.role || report.agentKey.slice(0, 8)),
    ),
    el('p', 'history-summary', report.summary || 'Sin resumen'),
  );
}

export function mountMemory(host: HTMLElement, store: Store, api: OfficeApi | null): void {
  host.replaceChildren();
  host.hidden = true;
  if (api === null) return;

  const client = api;
  const count = el('span', 'chip');
  count.hidden = true;
  const scope = el('p', 'memory-scope muted');
  const lessonsHost = el('div', 'memory-lessons');
  const text = el('textarea', 'memory-text');
  text.rows = 2;
  text.maxLength = LESSON_MAX_CHARS;
  text.placeholder = `Escribe una lección para este rol (máximo ${LESSON_MAX_CHARS} caracteres)…`;
  text.setAttribute('aria-label', 'Nueva lección');
  const add = button('Añadir lección', 'primary');
  const status = el('p', 'memory-status');
  const reportsHost = el('div', 'memory-reports');
  const form = el('div', 'memory-add', text, el('div', 'memory-add-actions', add, status));
  const body = el('div', 'panel-card-body', scope, lessonsHost, form, reportsHost);
  const summary = el('summary', 'panel-summary', el('span', 'section-title', 'Memoria'), count);
  host.append(el('details', 'panel-card', summary, body));

  let target: Target | null = null;
  let data: MemoryView | null = null;
  let failure: string | null = null;
  let seenVersion = 0;
  let ticket = 0;
  let busy = false;

  const versionOf = (current: Target): number => store.memoryVersion.get(memoryKey(current.floor, current.role)) ?? 0;

  const refreshForm = (): void => {
    text.disabled = busy;
    add.disabled = busy || target === null || text.value.trim() === '';
    add.textContent = busy ? 'Añadiendo…' : 'Añadir lección';
  };

  const lessonItem = (lesson: LessonView, now: number): HTMLElement => {
    const remove = button('✕', 'lesson-delete', 'Borrar lección');
    remove.addEventListener('click', () => void removeLesson(lesson, remove));
    const originText = lesson.origin === 'user' ? 'tú' : 'agente';
    const origin = el('span', `chip lesson-origin lesson-origin-${lesson.origin}`, originText);
    const author = lesson.agentKey === null ? undefined : store.agents.get(lesson.agentKey);
    if (author) origin.title = `Enviada por ${agentName(author)}`;
    return el(
      'li',
      'lesson',
      el('div', 'lesson-head', origin, el('time', 'muted', relativeTime(lesson.createdAt, now)), remove),
      el('p', 'lesson-text', lesson.text),
    );
  };

  const renderLists = (): void => {
    const current = data;
    if (current === null) {
      count.hidden = true;
      lessonsHost.replaceChildren(
        failure === null ? el('p', 'muted hint', 'Cargando memoria…') : el('p', 'memory-error hint', failure),
      );
      reportsHost.replaceChildren();
      return;
    }

    const now = store.now();
    const lessons = [...current.lessons].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
    count.hidden = false;
    count.textContent = String(lessons.length);
    const stale = failure === null ? [] : [el('p', 'memory-error hint', `No se pudo actualizar: ${failure}`)];
    lessonsHost.replaceChildren(
      lessons.length > 0
        ? el('ul', 'lesson-list', ...lessons.map((lesson) => lessonItem(lesson, now)))
        : el('p', 'muted hint', 'Sin lecciones todavía.'),
      ...stale,
    );

    const reports = [...current.reports].sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
    const shown = reports.slice(0, REPORT_LIMIT);
    const hidden = reports.length - shown.length;
    reportsHost.replaceChildren(
      el('h4', 'report-title', 'Informes anteriores del rol'),
      shown.length > 0
        ? el('ul', 'history-list', ...shown.map(reportItem), hidden > 0 ? el('li', 'muted', `y ${hidden} más`) : null)
        : el('p', 'muted hint', 'Sin informes guardados.'),
    );
  };

  const removeLesson = async (lesson: LessonView, control: HTMLButtonElement): Promise<void> => {
    if (busy || !window.confirm(`¿Borrar esta lección?\n\n${lesson.text}`)) return;
    busy = true;
    control.disabled = true;
    status.textContent = '';
    refreshForm();
    const result = await client.deleteLesson(lesson.id);
    busy = false;
    control.disabled = false;
    if (result.ok) {
      if (data) data = { ...data, lessons: data.lessons.filter((item) => item.id !== lesson.id) };
      renderLists();
    } else {
      status.textContent = result.message;
    }
    refreshForm();
  };

  const submit = async (): Promise<void> => {
    const current = target;
    const lesson = text.value.trim();
    if (current === null || lesson === '' || busy) return;
    busy = true;
    status.textContent = '';
    refreshForm();
    const result = await client.addLesson({ floor: current.floor, role: current.role, text: lesson });
    busy = false;
    if (result.ok) {
      const created = result.data.lesson;
      text.value = '';
      if (data && target === current && !data.lessons.some((item) => item.id === created.id)) {
        data = { ...data, lessons: [...data.lessons, created] };
        renderLists();
      }
    } else {
      status.textContent = result.message;
    }
    refreshForm();
  };

  const load = async (): Promise<void> => {
    const current = target;
    if (current === null) return;
    const mine = ++ticket;
    seenVersion = versionOf(current);
    const result = await client.memory(current.floor, current.role);
    if (mine !== ticket || target !== current) return;
    if (result.ok) {
      data = result.data;
      failure = null;
    } else {
      failure = result.message;
    }
    renderLists();
  };

  const sync = (): void => {
    const key = store.selectedKey;
    const agent = key === null ? undefined : store.agents.get(key);
    const floor = agent ? store.floorBySlug(agent.floor) : undefined;
    if (!agent || agent.roleId === null || agent.roleKind === 'planReviewer' || !floor || !MEMORY_KINDS.has(floor.kind)) {
      ticket += 1;
      target = null;
      data = null;
      failure = null;
      host.hidden = true;
      return;
    }

    const label = `Rol: ${ROLE_LABELS[agent.roleKind]} · Planta: ${floor.label}`;
    if (scope.textContent !== label) scope.textContent = label;
    host.hidden = false;
    if (target !== null && target.floor === agent.floor && target.role === agent.roleId) return;

    target = { floor: agent.floor, role: agent.roleId };
    data = null;
    failure = null;
    text.value = '';
    status.textContent = '';
    refreshForm();
    renderLists();
    void load();
  };

  text.addEventListener('input', refreshForm);
  text.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  });
  add.addEventListener('click', () => void submit());

  store.watch(['selection', 'agents', 'floors'], sync);

  store.watch(['memory'], () => {
    if (target !== null && versionOf(target) !== seenVersion) void load();
  });

  store.watch(['connection'], () => {
    if (store.connection === 'online' && target !== null) void load();
  });
}

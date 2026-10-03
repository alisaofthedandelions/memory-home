/* Shared project and rolling-context logic. No API keys or UI state. */
(function (root) {
  'use strict';
  const RETAINED = 10;
  const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const string = value => typeof value === 'string' ? value : '';
  function newProject(name = 'New project', seed = {}) {
    return { id: id(), name, prompt: string(seed.prompt), promptEnabled: seed.promptEnabled !== false,
      memory: { alisa: '', recent: '', kept: '', ...(seed.memory || {}) },
      lorebook: Array.isArray(seed.lorebook) ? seed.lorebook : [], revisions: [], createdAt: Date.now(), updatedAt: Date.now() };
  }
  function normalizeProjects(projects, legacyMemory = {}, legacyLorebook = []) {
    if (!Array.isArray(projects) || !projects.length) return [newProject('First home', {
      prompt: string(legacyMemory.core), memory: { alisa: string(legacyMemory.alisa), recent: string(legacyMemory.recent), kept: string(legacyMemory.kept) }, lorebook: legacyLorebook,
    })];
    return projects.map(project => ({ ...newProject(string(project.name) || 'Untitled project'), ...project,
      id: string(project.id) || id(), prompt: string(project.prompt), promptEnabled: project.promptEnabled !== false,
      memory: { alisa: '', recent: '', kept: '', ...(project.memory || {}) },
      lorebook: Array.isArray(project.lorebook) ? project.lorebook : [], revisions: Array.isArray(project.revisions) ? project.revisions : [] }));
  }
  function reviseProject(project, changes) {
    const next = { ...project, ...changes, updatedAt: Date.now() };
    if (next.name === project.name && next.prompt === project.prompt && next.promptEnabled === project.promptEnabled) return project;
    const snapshot = value => ({ id: id(), at: Date.now(), name: value.name, prompt: value.prompt, promptEnabled: value.promptEnabled });
    const revisions = [...project.revisions];
    const last = revisions[revisions.length - 1];
    if (!last || last.name !== project.name || last.prompt !== project.prompt || last.promptEnabled !== project.promptEnabled) revisions.push(snapshot(project));
    revisions.push(snapshot(next));
    return { ...next, revisions };
  }
  function normalizeMessages(messages) {
    return (Array.isArray(messages) ? messages : []).map(message => ({ ...message, id: string(message.id) || id() }));
  }
  const completed = messages => messages.filter(message => !message.live && !message.err && !message.error && string(message.content).trim());
  function summaryCursor(messages, summary) {
    if (!string(summary && summary.text).trim()) return -1;
    if (summary.throughMessageId) return messages.findIndex(message => message.id === summary.throughMessageId);
    const upto = Math.max(0, Math.min(messages.length, Number(summary.upto) || 0));
    return upto - 1;
  }
  function normalizeSummary(messages, summary = {}) {
    const cursor = summaryCursor(messages, summary);
    return { ...summary, text: string(summary.text), upto: cursor + 1, throughMessageId: cursor >= 0 ? messages[cursor].id : '' };
  }
  function foldBatch(messages, summary, windowSize, chunkSize, force = false) {
    const valid = completed(messages); const cursor = summaryCursor(messages, summary);
    const unsummarized = valid.filter(message => messages.indexOf(message) > cursor);
    if (!force && unsummarized.length <= Math.max(RETAINED, Number(windowSize) || 50)) return [];
    const older = valid.slice(0, Math.max(0, valid.length - RETAINED));
    return older.filter(message => messages.indexOf(message) > cursor).slice(0, Math.max(1, Number(chunkSize) || 20));
  }
  function historyForRequest(messages, summary, windowSize, rollingEnabled = true) {
    const valid = completed(messages); const cursor = summaryCursor(messages, summary);
    const protectedStart = valid.length ? messages.indexOf(valid[Math.max(0, valid.length - RETAINED)]) : messages.length;
    const remaining = messages.slice(Math.min(cursor + 1, protectedStart));
    const tail = completed(remaining);
    // Pending source messages stay visible when the keeper is slow or fails.
    return rollingEnabled ? tail : tail.slice(-Math.max(RETAINED, Number(windowSize) || 50));
  }
  function wakeLorebook(project, messages, extraText = '') {
    const hay = (completed(messages).slice(-6).map(message => message.content).join('\n') + '\n' + extraText).toLowerCase();
    return project.lorebook.filter(entry => entry.enabled && string(entry.keywords).split(',').map(word => word.trim().toLowerCase()).filter(Boolean).some(word => hay.includes(word)));
  }
  function projectContext(project, messages, summary, extraText = '', date = '') {
    const parts = date ? ['Today is ' + date + '.'] : [];
    if (project.promptEnabled && project.prompt.trim()) parts.push('═══ PROJECT PROMPT ═══\n' + project.prompt);
    const labels = { alisa: 'ABOUT THE USER', recent: 'RECENT MEMORIES', kept: 'KEPT IN THIS PROJECT' };
    for (const key of Object.keys(labels)) {
      const content = string(project.memory[key]);
      if (content.trim() && !(key === 'recent' && content.startsWith('(Recent memories'))) parts.push('═══ ' + labels[key] + ' ═══\n' + content);
    }
    const awake = wakeLorebook(project, messages, extraText);
    for (const entry of awake) parts.push('═══ LOREBOOK: ' + entry.name.toUpperCase() + ' ═══\nHistorical reference; follow current instructions.\n\n' + entry.content);
    if (summary && string(summary.text).trim()) parts.push('═══ EARLIER IN THIS CONVERSATION ═══\nHistorical context from this chat. The current project prompt and latest explicit corrections govern the present reply.\n\n' + summary.text);
    return { text: parts.join('\n\n'), awake };
  }
  function archiveData(state, messages, summaries, pending, trays) {
    return { version: 2, exported: new Date().toISOString(), settings: { ...state.settings, key: '' }, projects: state.projects,
      activeProjectId: state.projectId, currentChatId: state.cur, chats: state.chats, messages, summaries, pending, trays };
  }
  function restoreArchive(data, deviceKey) {
    if (!data || ![1, 2].includes(data.version) || (data.version === 1 ? !data.memory : !Array.isArray(data.projects))) throw new Error('Not a Memory Home archive');
    const projects = normalizeProjects(data.projects, data.memory, data.lorebook);
    const chats = (data.chats || []).map(chat => ({ ...chat, projectId: projects.some(project => project.id === chat.projectId) ? chat.projectId : projects[0].id }));
    const messages = Object.fromEntries(chats.map(chat => [chat.id, normalizeMessages((data.messages || {})[chat.id])]));
    const summaries = Object.fromEntries(chats.map(chat => [chat.id, normalizeSummary(messages[chat.id], (data.summaries || {})[chat.id])]));
    const pending = Object.fromEntries(chats.map(chat => [chat.id, (data.pending || {})[chat.id] || []]));
    const trays = data.version === 1 ? { [projects[0].id]: data.tray || [] } : data.trays || {};
    const cur = chats.find(chat => chat.id === data.currentChatId) || chats.find(chat => chat.projectId === data.activeProjectId) || chats[0];
    return { projects, chats, messages, summaries, pending, trays, settings: { ...(data.settings || {}), key: deviceKey }, cur: cur ? cur.id : null, projectId: cur ? cur.projectId : projects[0].id };
  }
  root.HomeCore = { RETAINED, newProject, normalizeProjects, reviseProject, normalizeMessages, normalizeSummary, summaryCursor, completed, foldBatch, historyForRequest, wakeLorebook, projectContext, archiveData, restoreArchive };
})(globalThis);

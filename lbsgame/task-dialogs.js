// Lazy-load the shared platform dialog only when a task needs a prompt.
window.taskConfirm = async message => {
    const { platformConfirm } = await import('../js/platformDialogs.js');
    return platformConfirm(message, '返回平台', '返回平台');
};
window.taskAlert = async message => {
    const { platformAlert } = await import('../js/platformDialogs.js');
    return platformAlert(message);
};

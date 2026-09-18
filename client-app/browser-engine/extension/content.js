(() => {
  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  addEventListener('keydown', (event) => {
    const key = String(event.key || '').toUpperCase();
    const devtools = key === 'F12' || (event.ctrlKey && event.shiftKey && ['I', 'J', 'C'].includes(key));
    if (devtools) stop(event);
  }, true);

  addEventListener('contextmenu', stop, true);
})();

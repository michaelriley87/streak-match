export function formatGameTime(value, now = new Date(), timeZone) {
  const date = new Date(value);
  const options = timeZone ? { timeZone } : {};
  const day = new Intl.DateTimeFormat('en-CA', { ...options, year:'numeric', month:'2-digit', day:'2-digit' });
  return new Intl.DateTimeFormat(undefined, { ...options, hour:'numeric', minute:'2-digit',
    ...(day.format(date) !== day.format(now) ? { month:'short', day:'numeric' } : {}) }).format(date);
}

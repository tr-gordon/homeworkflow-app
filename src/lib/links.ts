/** Static export has no dynamic routes, so an assignment is addressed by query string. */
export const assignmentHref = (id: string) => `/assignment?id=${encodeURIComponent(id)}`;

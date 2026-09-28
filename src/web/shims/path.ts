import p from 'path-browserify';
const posix = { ...p, sep: '/', resolve: (...a: string[]) => p.resolve('/', ...a) };
export const { join, dirname, basename, relative, normalize, extname } = p;
export const sep = '/';
export const resolve = posix.resolve;
export { posix };
export default { ...posix, posix };

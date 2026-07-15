// Field/record separators and pretty-format strings shared by the log/ref
// commands and their parsers (and the unit tests).

/** Unit separator between fields within a record. */
export const US = '\x1f';
/** Record separator between commits. */
export const RS = '\x1e';

/** Order of fields in {@link LOG_FORMAT}; the parser maps positionally. */
export const LOG_FORMAT = [
  '%H', '%P', '%an', '%ae', '%aI', '%cn', '%ce', '%cI', '%D', '%s', '%b',
].join(US) + RS;

/** for-each-ref format; `*objectname` dereferences annotated tags to the commit. */
export const REF_FORMAT = [
  '%(objectname)',
  '%(*objectname)',
  '%(refname)',
  '%(refname:short)',
  '%(upstream:short)',
  '%(upstream:track)',
  '%(HEAD)',
].join(US);

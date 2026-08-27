import assert from 'node:assert/strict';
import { inferDocumentContentType, isUnknownMimeType, withInferredMime } from './client-document-upload';

assert.equal(isUnknownMimeType(''), true);
assert.equal(isUnknownMimeType('application/octet-stream'), true);
assert.equal(isUnknownMimeType('binary/octet-stream'), true);
assert.equal(isUnknownMimeType('application/pdf'), false);

assert.equal(
  inferDocumentContentType({ name: 'rg.pdf', type: 'application/octet-stream' }),
  'application/pdf',
);
assert.equal(
  inferDocumentContentType({ name: 'foto.jpg', type: '' }),
  'image/jpeg',
);
assert.equal(
  inferDocumentContentType({ name: 'contrato.docx', type: 'binary/octet-stream' }),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
);
assert.equal(
  inferDocumentContentType({ name: 'ok.pdf', type: 'application/pdf' }),
  'application/pdf',
);

const remapped = withInferredMime(new File([new Uint8Array([1])], 'rg.pdf', { type: 'application/octet-stream' }));
assert.equal(remapped.type, 'application/pdf');

console.log('client-document-upload tests passed');

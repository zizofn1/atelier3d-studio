import type { Page } from '@playwright/test';
import { loadTemplate, triggerExport } from '../helpers/studio';

export interface FilePayloadFixture {
  id: string;
  description: string;
  payload: {
    name: string;
    mimeType: string;
    buffer: Buffer;
  };
}

export const INVALID_SYNTAX_JSON: FilePayloadFixture = {
  id: 'invalid-syntax-json',
  description: 'Malformed JSON syntax',
  payload: {
    name: 'syntaxe-invalide.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ "walls": [ invalid json :::', 'utf8'),
  },
};

export const EMPTY_BYTES_JSON: FilePayloadFixture = {
  id: 'empty-bytes-json',
  description: 'Zero-byte empty file',
  payload: {
    name: 'fichier-vide.json',
    mimeType: 'application/json',
    buffer: Buffer.alloc(0),
  },
};

export const EMPTY_OBJECT_JSON: FilePayloadFixture = {
  id: 'empty-object-json',
  description: 'Empty JSON object missing walls and modules',
  payload: {
    name: 'objet-vide.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{}', 'utf8'),
  },
};

export const WRONG_TYPES_JSON: FilePayloadFixture = {
  id: 'wrong-types-json',
  description: 'Schema type mismatch (walls/modules wrong types)',
  payload: {
    name: 'types-invalides.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        id: 12345,
        name: false,
        walls: 'not-an-array',
        modules: { invalid: true },
      }),
      'utf8',
    ),
  },
};

export const NEGATIVE_DIMS_JSON: FilePayloadFixture = {
  id: 'negative-dims-json',
  description: 'Negative wall and module dimensions',
  payload: {
    name: 'dimensions-negatives.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        id: 'projet-invalide-1',
        name: 'Projet Dimensions Négatives',
        walls: [
          {
            id: 'w-bad',
            x1: 0,
            y1: 0,
            x2: -500,
            y2: 0,
            length: -500,
            thickness: -20,
            height: 0,
          },
        ],
        modules: [
          {
            id: 'm-bad',
            type: 'caisson_bas',
            width: -600,
            height: 0,
            depth: -560,
          },
        ],
      }),
      'utf8',
    ),
  },
};

export const BINARY_MASQUERADE_JSON: FilePayloadFixture = {
  id: 'binary-masquerade-json',
  description: 'Binary PNG magic bytes masquerading as .json',
  payload: {
    name: 'corrompu.json',
    mimeType: 'application/json',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]),
  },
};

export const ALL_INVALID_PROJECT_FIXTURES: FilePayloadFixture[] = [
  INVALID_SYNTAX_JSON,
  EMPTY_BYTES_JSON,
  EMPTY_OBJECT_JSON,
  WRONG_TYPES_JSON,
  NEGATIVE_DIMS_JSON,
  BINARY_MASQUERADE_JSON,
];

export async function acquireValidProjectPayload(
  page: Page,
  templateName: 'Cuisine en L' | 'Dressing sur-mesure' = 'Cuisine en L',
): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  await loadTemplate(page, templateName);
  const { filename, buffer } = await triggerExport(page, 'export-project-json');
  return {
    name: filename || 'projet-valide.json',
    mimeType: 'application/json',
    buffer,
  };
}

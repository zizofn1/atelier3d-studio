import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { useProjectStore } from '@/store/useProjectStore';
import { triggerBlobDownload } from '@/utils/download';
import { withMountedScene3D } from './render3dExport';

export async function exportSceneGlbBlob(): Promise<Blob> {
  return withMountedScene3D(async ({ scene, exportGroup }) => {
    const target = exportGroup ?? scene;
    const exporter = new GLTFExporter();

    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(
        target,
        (result) => {
          if (result instanceof ArrayBuffer) {
            resolve(result);
          } else {
            const json = JSON.stringify(result);
            resolve(new TextEncoder().encode(json).buffer);
          }
        },
        (err) => {
          reject(
            err instanceof Error
              ? err
              : new Error('Échec de l’exportation 3D au format GLB.')
          );
        },
        { binary: true }
      );
    });

    return new Blob([buffer], { type: 'model/gltf-binary' });
  });
}

function slug(str: string): string {
  return (
    str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'projet'
  );
}

export async function downloadSceneGlb(): Promise<void> {
  const doc = useProjectStore.getState().document;
  const blob = await exportSceneGlbBlob();
  triggerBlobDownload(blob, `scene-3d-${slug(doc.name)}.glb`);
}

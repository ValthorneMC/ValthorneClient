// Static GLTF player model assets, ported from Modrinth (packages/assets/models/*.gltf).
// These are self-contained GLTF files (embedded base64 buffers) describing the rigged
// classic (Steve) and slim (Alex) player models, including the "idle"/"interact" animation
// clips and a dedicated "Cape" node/"cape" material used for cape rendering.

import ClassicPlayerModelUrl from '@/assets/models/classic-player.gltf?url';
import SlimPlayerModelUrl from '@/assets/models/slim-player.gltf?url';

export const ClassicPlayerModel = ClassicPlayerModelUrl;
export const SlimPlayerModel = SlimPlayerModelUrl;

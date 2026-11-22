// Optional boot. Load it from its own script tag.
// If this plugin id is already in infinite-canvas:plugin_store, it is left alone.
import {seedLineCameraPlugin} from './line-camera-core.mjs';

seedLineCameraPlugin(globalThis.localStorage);

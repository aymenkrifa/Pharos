import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { PharosIndicator } from './lib/indicator.js';

export default class PharosExtension extends Extension {
    enable() {
        this._indicator = new PharosIndicator(this.getSettings(), this.uuid, this.path);
        Main.panel.addToStatusArea('pharos', this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}

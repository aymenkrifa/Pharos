// One usage-window row in the panel menu:
//   title (left)  ······  percentage (right)
//   [============ progress bar ============]
//   resets 14:30 · in 2h 30m

import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// Fixed pixel width of the progress-bar track.
const BAR_WIDTH = 240;

export class UsageMeter {
    constructor(titleText) {
        this._item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        const box = new St.BoxLayout({
            vertical: true, x_expand: true, style_class: 'pharos-meter'
        });

        const header = new St.BoxLayout({
            x_expand: true, style_class: 'pharos-meter-header'
        });
        this._title = new St.Label({ text: titleText });
        // Small "limiting" badge, shown when the API flags this limit as the
        // one currently binding. Sits right after the title; tinted to match
        // the bar via setLimiting().
        this._chip = new St.Label({
            text: 'limiting',
            style_class: 'pharos-limiting',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._pct = new St.Label({
            text: '—',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            style_class: 'pharos-pct',
        });
        header.add_child(this._title);
        header.add_child(this._chip);
        header.add_child(this._pct);

        const track = new St.BoxLayout({ style_class: 'pharos-bar-track' });
        track.set_width(BAR_WIDTH);
        this._fill = new St.Widget({ style_class: 'pharos-bar-fill' });
        track.add_child(this._fill);

        this._caption = new St.Label({ text: '', style_class: 'pharos-reset' });

        box.add_child(header);
        box.add_child(track);
        box.add_child(this._caption);
        this._item.add_child(box);
    }

    // The menu item to insert with menu.addMenuItem().
    get item() {
        return this._item;
    }

    // Show a utilization percentage: label + bar sized/tinted accordingly.
    setUsage(pct, color) {
        this._pct.text = `${pct}%`;
        const clamped = Math.max(0, Math.min(100, pct));
        const w = Math.round(BAR_WIDTH * clamped / 100);
        this._fill.set_style(`background-color: ${color}; width: ${w}px;`);
    }

    // No data: placeholder percentage ('—' for errors, '…' while loading) and
    // an empty bar.
    clear(placeholder = '—') {
        this._pct.text = placeholder;
        this._fill.set_style('width: 0px;');
        this.setLimiting(false);
    }

    setTitle(text) {
        this._title.text = text;
    }

    // Show/hide the "limiting" badge, tinted like the bar.
    setLimiting(visible, color) {
        this._chip.visible = !!visible;
        if (visible && color)
            this._chip.set_style(`color: ${color}; border: 1px solid ${color};`);
    }

    // The line under the bar (reset countdown, or an error detail).
    setCaption(text) {
        this._caption.text = text;
    }
}

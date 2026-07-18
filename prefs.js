import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {readAccounts, writeAccounts} from './lib/accounts.js';

export default class PharosPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();

        const general = new Adw.PreferencesGroup({
            title: 'General',
            description: 'Usage is always fetched when you open the panel menu; ' +
                'the background interval below keeps the panel color fresh in between.',
        });
        page.add(general);

        // Background poll interval (0 = only fetch on menu open)
        const interval = new Adw.SpinRow({
            title: 'Background refresh (seconds)',
            subtitle: '0 = off; only refresh when the menu is opened',
            adjustment: new Gtk.Adjustment({lower: 0, upper: 3600, step_increment: 30}),
        });
        settings.bind('refresh-seconds', interval, 'value', Gio.SettingsBindFlags.DEFAULT);
        general.add(interval);

        // Beacon state thresholds: caution → warning → critical
        const caution = new Adw.SpinRow({
            title: 'Caution threshold (%)',
            subtitle: 'Light on the horizon at or above this',
            adjustment: new Gtk.Adjustment({lower: 1, upper: 100, step_increment: 5}),
        });
        settings.bind('caution-threshold', caution, 'value', Gio.SettingsBindFlags.DEFAULT);
        general.add(caution);

        const warn = new Adw.SpinRow({
            title: 'Warning threshold (%)',
            subtitle: 'Full beam at or above this',
            adjustment: new Gtk.Adjustment({lower: 1, upper: 100, step_increment: 5}),
        });
        settings.bind('warn-threshold', warn, 'value', Gio.SettingsBindFlags.DEFAULT);
        general.add(warn);

        const crit = new Adw.SpinRow({
            title: 'Critical threshold (%)',
            subtitle: 'On the rocks at or above this',
            adjustment: new Gtk.Adjustment({lower: 1, upper: 100, step_increment: 5}),
        });
        settings.bind('crit-threshold', crit, 'value', Gio.SettingsBindFlags.DEFAULT);
        general.add(crit);

        // Accounts: none configured = a single auto-detected ~/.claude account
        // and no switcher in the panel menu.
        const accountsGroup = new Adw.PreferencesGroup({
            title: 'Accounts',
            description: 'Leave empty to use ~/.claude/.credentials.json. Add two ' +
                'or more accounts to get a switcher in the panel menu.',
        });
        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            tooltip_text: 'Add account',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        accountsGroup.set_header_suffix(addButton);
        page.add(accountsGroup);

        // How the active account is shown next to the panel icon (the menu
        // switcher always shows full labels).
        const STYLE_VALUES = ['full', 'short', 'none'];
        const labelStyle = new Adw.ComboRow({
            title: 'Panel label',
            subtitle: 'How the active account is shown next to the panel icon',
            model: Gtk.StringList.new(['Full label', 'First letter', 'Hidden']),
            selected: Math.max(0, STYLE_VALUES.indexOf(settings.get_string('panel-label-style'))),
        });
        labelStyle.connect('notify::selected', () => {
            settings.set_string('panel-label-style', STYLE_VALUES[labelStyle.selected]);
        });
        accountsGroup.add(labelStyle);

        // Entry edits are committed on apply (Enter / checkmark) rather than per
        // keystroke, so the extension isn't re-fetching mid-typing.
        const rows = [];
        const rebuild = () => {
            for (const row of rows)
                accountsGroup.remove(row);
            rows.length = 0;

            readAccounts(settings).forEach((account, i) => {
                const row = new Adw.ExpanderRow({
                    title: account.label || `Account ${i + 1}`,
                });

                const label = new Adw.EntryRow({
                    title: 'Label',
                    text: account.label,
                    show_apply_button: true,
                });
                label.connect('apply', () => {
                    const accounts = readAccounts(settings);
                    if (!accounts[i])
                        return;
                    accounts[i].label = label.text;
                    writeAccounts(settings, accounts);
                    row.title = label.text || `Account ${i + 1}`;
                });
                row.add_row(label);

                const path = new Adw.EntryRow({
                    title: 'Credentials path (blank = ~/.claude/.credentials.json)',
                    text: account.path,
                    show_apply_button: true,
                });
                path.connect('apply', () => {
                    const accounts = readAccounts(settings);
                    if (!accounts[i])
                        return;
                    accounts[i].path = path.text;
                    writeAccounts(settings, accounts);
                });
                row.add_row(path);

                const remove = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    tooltip_text: 'Remove account',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat'],
                });
                remove.connect('clicked', () => {
                    const accounts = readAccounts(settings);
                    accounts.splice(i, 1);
                    // Keep the active index pointing at a real entry.
                    const active = settings.get_int('active-account-index');
                    if (active >= accounts.length)
                        settings.set_int('active-account-index', Math.max(0, accounts.length - 1));
                    writeAccounts(settings, accounts);
                    rebuild();
                });
                row.add_suffix(remove);

                accountsGroup.add(row);
                rows.push(row);
            });
        };
        rebuild();

        addButton.connect('clicked', () => {
            const accounts = readAccounts(settings);
            accounts.push({label: `Account ${accounts.length + 1}`, path: ''});
            writeAccounts(settings, accounts);
            rebuild();
        });

        // About
        const about = new Adw.PreferencesGroup({ title: 'About' });

        const author = new Adw.ActionRow({
            title: 'Made by Aymen Krifa',
            subtitle: 'aymenkrifa.com',
            activatable: true,
        });
        author.add_suffix(new Gtk.Image({ icon_name: 'adw-external-link-symbolic' }));
        author.connect('activated', () =>
            Gtk.show_uri(window, 'https://aymenkrifa.com', 0));
        about.add(author);

        const source = new Adw.ActionRow({
            title: 'Source code',
            subtitle: this.metadata.url,
            activatable: true,
        });
        source.add_suffix(new Gtk.Image({ icon_name: 'adw-external-link-symbolic' }));
        source.connect('activated', () =>
            Gtk.show_uri(window, this.metadata.url, 0));
        about.add(source);

        page.add(about);

        window.add(page);
    }
}

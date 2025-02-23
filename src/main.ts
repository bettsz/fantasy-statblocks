import {
    addIcon,
    MarkdownPostProcessorContext,
    Notice,
    ObsidianProtocolHandler,
    parseYaml,
    Plugin,
    WorkspaceLeaf
} from "obsidian";
import domtoimage from "dom-to-image";

import StatBlockRenderer from "./view/statblock";
import { nanoid } from "./util/util";
import type { Monster, StatblockParameters } from "../index";
import StatblockSettingTab from "./settings/settings";
import fastCopy from "fast-copy";

import { ExpectedValue, type HomebrewCreature } from "obsidian-overload";
import type { Layout, StatblockItem } from "./layouts/layout.types";
import { Layout5e } from "./layouts/basic 5e/basic5e";
import { StatblockSuggester } from "./suggest";
import { DefaultLayouts } from "./layouts";
import type { StatblockData } from "index";
import LayoutManager from "./layouts/manager";
import { CREATURE_VIEW, CreatureView } from "./combatant";
import { API } from "./api/api";
import { Linkifier } from "./parser/linkify";
import { Bestiary } from "./bestiary/bestiary";

export const DICE_ROLLER_SOURCE = "FANTASY_STATBLOCKS_PLUGIN";

const DEFAULT_DATA: StatblockData = {
    monsters: [],
    defaultLayouts: [...DefaultLayouts.map((l) => fastCopy(l))],
    layouts: [],
    default: Layout5e.name,
    useDice: true,
    renderDice: false,
    export: true,
    showAdvanced: false,
    version: {
        major: null,
        minor: null,
        patch: null
    },
    paths: ["/"],
    autoParse: false,
    disableSRD: false,
    tryToRenderLinks: true,
    debug: false,
    notifiedOfFantasy: false,
    hideConditionHelp: false,
    alwaysImport: false,
    defaultLayoutsIntegrated: false,
    atomicWrite: true
};

export default class StatBlockPlugin extends Plugin {
    settings: StatblockData;
    manager = new LayoutManager();
    api: API = new API(this);

    getRoller(str: string) {
        if (!this.canUseDiceRoller) return;
        const roller = this.app.plugins
            .getPlugin("obsidian-dice-roller")
            ?.api.getRollerSync(str, DICE_ROLLER_SOURCE);
        return roller;
    }
    getRollerString(str: string) {
        if (!this.canUseDiceRoller) return str;
        return this.app.plugins
            .getPlugin("obsidian-dice-roller")
            ?.api.getRollerString(str, DICE_ROLLER_SOURCE);
    }
    get diceRollerInstalled() {
        if (this.app.plugins.getPlugin("obsidian-dice-roller") != null) {
            if (!this.app.plugins.getPlugin("obsidian-dice-roller").api) {
                new Notice(
                    "Please update Dice Roller to the latest version to use with Fantasy Statblocks."
                );
                return false;
            }
            return true;
        }
        return false;
    }
    get canUseDiceRoller() {
        if (this.diceRollerInstalled) {
            return this.settings.useDice;
        }
        return false;
    }

    get creature_view() {
        const leaves = this.app.workspace.getLeavesOfType(CREATURE_VIEW);
        const leaf = leaves?.length ? leaves[0] : null;
        if (leaf && leaf.view && leaf.view instanceof CreatureView)
            return leaf.view;
    }
    async openCreatureView() {
        const leaf = this.app.workspace.getRightLeaf(true);
        await leaf.setViewState({
            type: CREATURE_VIEW
        });
        this.app.workspace.revealLeaf(leaf);
        return leaf.view as CreatureView;
    }

    #creaturePaneProtocolHandler: ObsidianProtocolHandler = (data) => {
        const name = data?.creature ?? data?.name ?? "";

        if (Bestiary.hasCreature(name)) {
            const creature = Bestiary.get(name);
            if (!this.creature_view) {
                this.openCreatureView().then((v) => v.render(creature));
            } else {
                this.creature_view.render(creature);
            }
        }
    };
    async onload() {
        console.log("Fantasy StatBlocks loaded");
        await this.loadSettings();
        await this.saveSettings();

        this.manager.initialize(this.settings);

        Bestiary.initialize(this);
        Linkifier.initialize(this.app.metadataCache);

        this.register(() => Linkifier.unload());

        this.addCommand({
            id: "open-creature-view",
            name: "Open Creature Pane",
            callback: () => {
                this.openCreatureView();
            }
        });
        this.addRibbonIcon("skull", "Open Creature Pane", async () => {
            this.openCreatureView();
        });
        this.registerObsidianProtocolHandler(
            "creature-pane",
            this.#creaturePaneProtocolHandler.bind(this)
        );

        addIcon(
            "markdown-icon",
            `<svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512"><!--! Font Awesome Pro 6.2.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license (Commercial License) Copyright 2022 Fonticons, Inc. --><path d="M593.8 59.1H46.2C20.7 59.1 0 79.8 0 105.2v301.5c0 25.5 20.7 46.2 46.2 46.2h547.7c25.5 0 46.2-20.7 46.1-46.1V105.2c0-25.4-20.7-46.1-46.2-46.1zM338.5 360.6H277v-120l-61.5 76.9-61.5-76.9v120H92.3V151.4h61.5l61.5 76.9 61.5-76.9h61.5v209.2zm135.3 3.1L381.5 256H443V151.4h61.5V256H566z"/></svg>`
        );

        this.addSettingTab(new StatblockSettingTab(this.app, this));

        (window["FantasyStatblocks"] = this.api) &&
            this.register(() => delete window["FantasyStatblocks"]);

        this.registerMarkdownCodeBlockProcessor(
            "statblock",
            this.postprocessor.bind(this)
        );

        this.registerEditorSuggest(new StatblockSuggester(this));

        this.registerView(
            CREATURE_VIEW,
            (leaf: WorkspaceLeaf) => new CreatureView(leaf, this)
        );
        if (this.canUseDiceRoller) {
            this.app.plugins
                .getPlugin("obsidian-dice-roller")
                ?.api.registerSource(DICE_ROLLER_SOURCE, {
                    showDice: true,
                    shouldRender: this.settings.renderDice,
                    showFormula: false,
                    showParens: false,
                    expectedValue: ExpectedValue.Average,
                    text: null
                });
        }
        this.registerEvent(
            this.app.workspace.on("dice-roller:loaded", () => {
                this.app.plugins
                    .getPlugin("obsidian-dice-roller")
                    ?.api.registerSource(DICE_ROLLER_SOURCE, {
                        showDice: true,
                        shouldRender: this.settings.renderDice,
                        showFormula: false,
                        showParens: false,
                        expectedValue: ExpectedValue.Average,
                        text: null
                    });
            })
        );
    }
    async loadSettings() {
        const settings: StatblockData = await this.loadData();

        if (settings != undefined && !("version" in settings)) {
            //1.X settings;
            this.settings = { ...DEFAULT_DATA };
            this.settings.monsters = settings as any as [string, Monster][];

            new Notice(
                "5e Statblocks is now TTRPG Statblocks. Check out the ReadMe for more information!"
            );
        } else {
            if (
                settings &&
                settings?.version?.major >= 2 &&
                settings?.version?.minor >= 25 &&
                !settings?.notifiedOfFantasy
            ) {
                new Notice("TTRPG Statblocks is now Fantasy Statblocks!");
                settings.notifiedOfFantasy = true;
            }
            this.settings = {
                ...DEFAULT_DATA,
                ...settings
            };
        }
        if (!this.settings.defaultLayoutsIntegrated) {
            for (const layout of this.settings.layouts) {
                layout.id = nanoid();
            }
            this.settings.default = (
                this.layouts.find(
                    ({ name }) => name == this.settings.default
                ) ?? Layout5e
            ).id;

            this.settings.defaultLayoutsIntegrated = true;
        }
        if (this.settings.defaultLayouts.length != DefaultLayouts.length) {
            for (const layout of DefaultLayouts) {
                if (this.settings.defaultLayouts.find((l) => l.id == layout.id))
                    continue;
                this.settings.defaultLayouts.push(fastCopy(layout));
            }
            for (const layout of this.settings.defaultLayouts) {
                if (DefaultLayouts.find((l) => l.id == layout.id)) continue;
                this.settings.layouts.push(layout);
                this.settings.defaultLayouts.splice(
                    this.settings.defaultLayouts.indexOf(layout),
                    1
                );
            }
            this.settings.layouts = this.settings.layouts.filter(
                (layout) =>
                    !this.settings.defaultLayouts.find((l) => l.id == layout.id)
            );
        }
        for (const layout of DefaultLayouts) {
            if (!layout.version) continue;
            const existing = this.settings.defaultLayouts.find(
                (l) => l.id === layout.id
            );
            if (existing.version >= layout.version) continue;
            if (existing.edited) {
                existing.updatable = true;
                continue;
            }
            existing.blocks = fastCopy(layout.blocks);
        }

        function fixSpells(...blocks: StatblockItem[]) {
            for (const block of blocks) {
                if (block.type == "spells") {
                    if (!block.properties.length)
                        block.properties.push("spells");
                }
                if ("nested" in block) {
                    fixSpells(...block.nested);
                }
            }
        }
        for (const layout of this.settings.layouts) {
            fixSpells(...layout.blocks);
        }

        const version = this.manifest.version.split(".");
        this.settings.version = {
            major: Number(version[0]),
            minor: Number(version[1]),
            patch: Number(version[2])
        };
    }
    async saveSettings() {
        this.app.workspace.trigger(
            "fantasy-statblocks:settings-change",
            this.settings
        );
        await this.saveData(this.settings);
    }
    async loadData(): Promise<StatblockData> {
        return (await super.loadData()) as StatblockData;
    }
    async saveData(settings: StatblockData) {
        if (this.settings.atomicWrite) {
            try {
                await this.app.vault.adapter.write(
                    `${this.manifest.dir}/temp.json`,
                    JSON.stringify(settings, null, null)
                );

                await this.app.vault.adapter.remove(
                    `${this.manifest.dir}/data.json`
                );
                await this.app.vault.adapter.rename(
                    `${this.manifest.dir}/temp.json`,
                    `${this.manifest.dir}/data.json`
                );
            } catch (e) {
                super.saveData(settings);
            }
        } else {
            super.saveData(settings);
        }
    }

    async saveMonster(monster: Monster, save: boolean = true) {
        if (!monster.name) return;
        if (Bestiary.isLocal(monster.name)) {
            //already exists, replace it
            const index = this.settings.monsters.findIndex(
                ([name]) => name === monster.name
            );
            if (index >= 0) {
                this.settings.monsters.splice(index, 1, [
                    monster.name,
                    monster
                ]);
            } else {
                this.settings.monsters.push([monster.name, monster]);
            }
        } else {
            this.settings.monsters.push([monster.name, monster]);
        }
        Bestiary.addLocalCreature(monster);

        if (save) {
            await this.saveSettings();
        }
    }
    async saveMonsters(monsters: Monster[]) {
        for (let monster of monsters) {
            await this.saveMonster(monster, false);
        }
        await this.saveSettings();
    }

    async updateMonster(oldMonster: Monster, newMonster: Monster) {
        this.deleteMonster(oldMonster.name, false);
        await this.saveMonster(newMonster);
    }

    async deleteMonsters(...monsters: string[]) {
        for (let monster of monsters) {
            Bestiary.removeLocalCreature(monster);
        }
        this.settings.monsters = this.settings.monsters.filter(
            ([name]) => !monsters.includes(name)
        );
        await this.saveSettings();
    }

    async deleteMonster(monster: string, save = true) {
        Bestiary.removeLocalCreature(monster);
        if (save) await this.saveSettings();
    }

    onunload() {
        console.log("Fantasy StatBlocks unloaded");

        this.app.workspace
            .getLeavesOfType(CREATURE_VIEW)
            .forEach((leaf) => leaf.detach());
    }

    exportAsPng(name: string, containerEl: Element) {
        function filter(node: HTMLElement) {
            return !node.hasClass || !node.hasClass("clickable-icon");
        }
        const content =
            containerEl.querySelector<HTMLDivElement>(".statblock-content");
        if (content) delete content.style["boxShadow"];
        domtoimage
            .toPng(containerEl, {
                filter: filter,
                style: { height: "100%" }
            })
            .then((url) => {
                const link = document.createElement("a");
                link.download = name + ".png";
                link.href = url;
                link.click();
                link.detach();
            })
            .catch((e) => {
                new Notice(
                    `There was an error creating the image: \n\n${e.message}`
                );
                console.error(e);
            });
    }

    get layouts() {
        return this.manager.getAllLayouts();
    }

    get defaultLayout() {
        return this.manager.getDefaultLayout();
    }

    getLayoutOrDefault(monster: Monster): Layout {
        return this.manager.getLayoutOrDefault(monster.layout);
    }

    async postprocessor(
        source: string,
        el: HTMLElement,
        ctx: MarkdownPostProcessorContext
    ) {
        try {
            /** Replace Links */
            source = Linkifier.transformSource(source);

            /** Get Parameters */
            let params: StatblockParameters = parseYaml(source);

            el.addClass("statblock-plugin-container");
            el.parentElement?.addClass("statblock-plugin-parent");

            let statblock = new StatBlockRenderer({
                container: el,
                plugin: this,
                params,
                context: ctx.sourcePath
            });

            ctx.addChild(statblock);
        } catch (e) {
            console.error(`Obsidian Statblock Error:\n${e}`);
            let pre = createEl("pre");
            pre.setText(`\`\`\`statblock
There was an error rendering the statblock:
${e.stack
    .split("\n")
    .filter((line: string) => !/^at/.test(line?.trim()))
    .join("\n")}
\`\`\``);
        }
    }
    //backwards-compat
    render(creature: HomebrewCreature, el: HTMLElement, display?: string) {
        this.api.render(creature, el, display);
    }
}

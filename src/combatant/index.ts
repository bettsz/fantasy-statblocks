import type { Monster } from "index";
import {
    ItemView,
    type WorkspaceLeaf,
    debounce,
    ExtraButtonComponent,
    TextComponent,
    SearchComponent
} from "obsidian";
import type StatBlockPlugin from "src/main";
import { MonsterSuggestionModal } from "src/util/creature";

export const CREATURE_VIEW = "fantasy-statblocks-creature-pane";

export class CreatureView extends ItemView {
    topEl = this.contentEl.createDiv("creature-view-top-pane");
    statblockEl = this.contentEl.createDiv("creature-statblock-container");
    constructor(leaf: WorkspaceLeaf, public plugin: StatBlockPlugin) {
        super(leaf);
        this.load();
        this.containerEl.addClasses([
            "fantasy-statblocks",
            "creature-view-container"
        ]);
        this.containerEl.on(
            "mouseover",
            "a.internal-link",
            debounce((ev) => {
                this.plugin.app.workspace.trigger(
                    "link-hover",
                    {}, //hover popover, but don't need
                    ev.target as HTMLElement, //targetEl
                    (ev.target as HTMLAnchorElement).dataset.href, //linkText
                    "fantasy-statblocks " //source
                );
            }, 10)
        );
        this.containerEl.on("click", "a.internal-link", (ev) =>
            app.workspace.openLinkText(
                (ev.target as HTMLAnchorElement).dataset.href,
                "fantasy-statblocks"
            )
        );
    }
    onload() {
        const search = new SearchComponent(this.topEl).setPlaceholder(
            "Find a creature"
        );
        const suggester = new MonsterSuggestionModal(
            this.plugin.app,
            search,
            this.plugin.api.getBestiaryCreatures()
        );
        suggester.onSelect(async (v) => {
            if (v) {
                await this.render(v.item);
                search.setValue("");
            }
        });
        new ExtraButtonComponent(this.topEl)
            .setIcon("cross")
            .setTooltip("Close Statblock")
            .onClick(async () => {
                await this.render();
                search.setValue("");
            });
    }
    async render(creature?: Partial<Monster>) {
        this.statblockEl.empty();
        if (!creature) {
            this.statblockEl.createEl("em", {
                text: "Select a creature to view it here."
            });
            return;
        }
        const statblock = this.plugin.api.render(creature, this.statblockEl);
        this.addChild(statblock);
    }

    getDisplayText(): string {
        return "Combatant";
    }
    getIcon(): string {
        return "skull";
    }
    getViewType(): string {
        return CREATURE_VIEW;
    }
}

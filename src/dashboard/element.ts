import {
  toDashboardViewModel,
  type DashboardAudience,
  type DashboardOptions,
  type DashboardPeriodState,
} from "../dashboard-view.js";
import { ScorecardSnapshotSchema, type ScorecardSnapshot } from "../schemas.js";
import { DASHBOARD_STYLES, renderDashboardMarkup } from "./dom.js";

export const AI_ROI_DASHBOARD_TAG = "ai-roi-dashboard";

export interface AiRoiDashboardElement extends HTMLElement {
  dashboardOptions: DashboardOptions;
  previousSnapshot: ScorecardSnapshot | undefined;
  snapshot: ScorecardSnapshot | undefined;
}

function createDashboardElementClass(): CustomElementConstructor {
  return class extends HTMLElement implements AiRoiDashboardElement {
    #snapshot: ScorecardSnapshot | undefined;
    #previousSnapshot: ScorecardSnapshot | undefined;
    #dashboardOptions: DashboardOptions = {};

    static get observedAttributes(): string[] {
      return ["audience", "period-state", "account-name"];
    }

    connectedCallback(): void {
      if (!this.shadowRoot) {
        this.attachShadow({ mode: "open" });
      }
      this.#render();
    }

    attributeChangedCallback(): void {
      this.#render();
    }

    get snapshot(): ScorecardSnapshot | undefined {
      return this.#snapshot;
    }

    set snapshot(value: ScorecardSnapshot | undefined) {
      this.#snapshot = value;
      this.#render();
    }

    get previousSnapshot(): ScorecardSnapshot | undefined {
      return this.#previousSnapshot;
    }

    set previousSnapshot(value: ScorecardSnapshot | undefined) {
      this.#previousSnapshot = value;
      this.#render();
    }

    get dashboardOptions(): DashboardOptions {
      return this.#dashboardOptions;
    }

    set dashboardOptions(value: DashboardOptions) {
      this.#dashboardOptions = value;
      this.#render();
    }

    #optionsFromAttributes(): DashboardOptions {
      const audience = this.getAttribute("audience");
      const periodState = this.getAttribute("period-state");
      const accountName = this.getAttribute("account-name");
      return {
        ...this.#dashboardOptions,
        ...(accountName ? { accountName } : {}),
        ...(audience === "operator" || audience === "cfo"
          ? { audience: audience as DashboardAudience }
          : {}),
        ...(periodState === "open" || periodState === "sealed"
          ? { periodState: periodState as DashboardPeriodState }
          : {}),
      };
    }

    #render(): void {
      const root = this.shadowRoot;
      if (!root) return;

      if (!this.#snapshot) {
        root.innerHTML = `<style>${DASHBOARD_STYLES}</style><div class="shell"><div class="body"><p class="meta">Assign a scorecard snapshot to display value.</p></div></div>`;
        return;
      }

      const snapshot = ScorecardSnapshotSchema.parse(this.#snapshot);
      const options = this.#optionsFromAttributes();
      const view = toDashboardViewModel(snapshot, {
        ...options,
        ...(this.#previousSnapshot === undefined
          ? {}
          : { previousSnapshot: ScorecardSnapshotSchema.parse(this.#previousSnapshot) }),
      });
      root.innerHTML = `<style>${DASHBOARD_STYLES}</style>${renderDashboardMarkup(view)}`;
    }
  };
}

export function registerAiRoiDashboard(): void {
  if (typeof customElements === "undefined" || typeof HTMLElement === "undefined") {
    return;
  }
  if (!customElements.get(AI_ROI_DASHBOARD_TAG)) {
    customElements.define(AI_ROI_DASHBOARD_TAG, createDashboardElementClass());
  }
}

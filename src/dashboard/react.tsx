import { createElement, useEffect, useRef } from "react";

import type { DashboardOptions } from "../dashboard-view.js";
import type { ScorecardSnapshot } from "../schemas.js";
import { type AiRoiDashboardElement, registerAiRoiDashboard } from "./element.js";

export interface AiRoiDashboardReactProps extends DashboardOptions {
  previousSnapshot?: ScorecardSnapshot;
  snapshot?: ScorecardSnapshot;
}

export function AiRoiDashboard({
  snapshot,
  previousSnapshot,
  accountName,
  audience,
  deltaLabel,
  locale,
  periodState,
}: AiRoiDashboardReactProps) {
  const ref = useRef<AiRoiDashboardElement>(null);

  useEffect(() => {
    registerAiRoiDashboard();
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.snapshot = snapshot;
    element.previousSnapshot = previousSnapshot;
    element.dashboardOptions = {
      ...(accountName === undefined ? {} : { accountName }),
      ...(audience === undefined ? {} : { audience }),
      ...(deltaLabel === undefined ? {} : { deltaLabel }),
      ...(locale === undefined ? {} : { locale }),
      ...(periodState === undefined ? {} : { periodState }),
    };
  }, [snapshot, previousSnapshot, accountName, audience, deltaLabel, locale, periodState]);

  return createElement("ai-roi-dashboard", { ref });
}

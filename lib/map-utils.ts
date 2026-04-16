import type { Dispatch, SetStateAction } from "react";
import type { Region, StanceType } from "@/types";

export const STANCE_HEX: Record<StanceType, string> = {
  restrictive: "#D98080",
  concerning: "#D9A766",
  review: "#D9C980",
  none: "#C9CBD1",
  favorable: "#7EBC8E",
};

export const NEUTRAL_FILL = "#EFEDE8";
export const NEUTRAL_STROKE = "#E5E5E5";
export const INK = "#1D1D1F";

export interface TooltipState {
  x: number;
  y: number;
  label: string;
  /** Set for entity hovers so MapShell can show a rich tooltip. */
  geoId?: string;
  region?: Region;
  /** True for US states that have county-level municipal data. Surfaced
   *  in the tooltip so users know they can double-click to drill in. */
  drillable?: boolean;
  /** 5-digit county FIPS — set on county hovers in CountyMap so MapShell
   *  can render a rich municipality tooltip (actions, context, etc.). */
  countyFips?: string;
}

export type SetTooltip = Dispatch<SetStateAction<TooltipState | null>>;

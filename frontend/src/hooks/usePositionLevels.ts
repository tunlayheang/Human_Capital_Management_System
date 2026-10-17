import { useCallback, useEffect, useState } from 'react';
import { Api } from '../services/api';
import {
  FALLBACK_POSITION_LEVEL_OPTIONS,
  setPositionLevelOptions,
  type PositionLevelOption,
} from '../constants/positionCatalog';
import type { PositionLevelRecord } from '../types/positionLevels';

function toOptions(levels: PositionLevelRecord[]): PositionLevelOption[] {
  return levels.map((l) => ({
    value: l.code,
    label: l.label,
    structureTier: l.structureTier,
    tier: l.tier,
    sortOrder: l.sortOrder,
  }));
}

export function usePositionLevels() {
  const [options, setOptions] = useState<PositionLevelOption[]>(() => FALLBACK_POSITION_LEVEL_OPTIONS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await Api.catalog.getPositionLevels();
      const next = toOptions(data.levels ?? []);
      setPositionLevelOptions(next);
      setOptions(next);
    } catch {
      setOptions(FALLBACK_POSITION_LEVEL_OPTIONS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { options, loading, refresh };
}

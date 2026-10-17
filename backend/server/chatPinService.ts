import * as chatMeta from './chatMetaRepository.js';

export type PinTargetKind = 'direct' | 'group';

export type ChatPinRow = {
  targetKind: PinTargetKind;
  targetId: string;
  pinnedAt: string;
};

export async function listChatPins(userId: string): Promise<ChatPinRow[]> {
  const rows = await chatMeta.listPinsForUser(userId);
  return rows.map((r) => ({
    targetKind: r.targetKind,
    targetId: r.targetId,
    pinnedAt: r.pinnedAt,
  }));
}

export async function setChatPin(
  userId: string,
  targetKind: PinTargetKind,
  targetId: string,
  pinned: boolean
): Promise<ChatPinRow[]> {
  const id = `pin-${userId}-${targetKind}-${targetId}`;
  if (pinned) {
    const now = new Date().toISOString();
    await chatMeta.upsertPin({
      id,
      userId,
      targetKind,
      targetId,
      pinnedAt: now,
    });
  } else {
    await chatMeta.deletePin(userId, targetKind, targetId);
  }
  return listChatPins(userId);
}

export function pinKeySet(pins: ChatPinRow[]): { direct: Set<string>; groups: Set<string> } {
  const direct = new Set<string>();
  const groups = new Set<string>();
  for (const p of pins) {
    if (p.targetKind === 'group') groups.add(p.targetId);
    else direct.add(p.targetId);
  }
  return { direct, groups };
}

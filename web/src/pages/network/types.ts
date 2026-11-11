export type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'link'; id: string }
  | { kind: 'customer'; id: string };

/** dataTransfer type used when dragging a node type from the palette onto the canvas / map. */
export const DND_TYPE = 'application/x-fiber-node';

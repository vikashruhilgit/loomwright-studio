// Which mark a Memory folder wears (phase 7 item 26), as the GUI v2 mockup's `memoryScreen` draws it:
// an agent's folder shows that agent's avatar, the shared folder shows the shared icon
// (`${g.ag ? avatarHTML(AGENTS[g.ag], 20) : I.team}`). The roster is the live store's `agents` resource; a roster
// that has not answered, or has no entry for the folder, gives the avatar's own fish/slate fallback, so the tree
// never waits on it.
//
// The mark is decorative: the slot is `aria-hidden`, because the folder's name beside it (and the group's
// `aria-label`) already names the thing, and the avatar's own label ("<Name> · idle") would claim a state Memory
// does not know.
import type { RosterEntry } from "../../api/contract";
import { Avatar } from "../../components/Avatar/Avatar";
import { Icon } from "../../components/icons";
import { printable } from "../approvals/printable";

/** The folder that holds the files every agent shares: it has no avatar. */
export const SHARED_FOLDER = "shared";

/** The avatar's edge, in px, as the mockup draws it on a folder header and an overview row. */
const MARK_SIZE = 20;

export interface FolderMarkProps {
  /** The folder under `memory/`: an agent id, or `shared`. */
  readonly folder: string;
  /** The name shown for the folder (the capitalised folder name), used when the roster has no display name. */
  readonly label: string;
  /** The roster, once it has answered; `undefined` until then or when the read failed. */
  readonly roster: readonly RosterEntry[] | undefined;
}

export function FolderMark({ folder, label, roster }: FolderMarkProps) {
  if (folder === SHARED_FOLDER) {
    return (
      <span className="memory-mark" aria-hidden="true">
        <Icon name="shared" className="memory-mark-icon" />
      </span>
    );
  }
  const entry = roster?.find((a) => a.id === folder);
  const name = entry === undefined ? label : printable(entry.display_name);
  return (
    <span className="memory-mark" aria-hidden="true">
      <Avatar agent={{ id: folder, name: name === "" ? label : name, shape: entry?.avatar.shape, hue: entry?.avatar.hue }} state="idle" size={MARK_SIZE} />
    </span>
  );
}

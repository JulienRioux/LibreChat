import { memo, useMemo } from 'react';
import { apiBaseUrl } from 'librechat-data-provider';
import { BrowseFrame, toShots } from '@librechat/chat/components';
import type { BrowseCall, Shot } from '@librechat/chat/components';
import type { TAttachment } from 'librechat-data-provider';
import { saveImage, toAbsoluteFilePath } from '~/utils';
import { useMCPServerNames } from '~/hooks/MCP';

/** A screenshot and the tool call it came back from, as the transcript holds them. */
export type ShotFile = { file: TAttachment; call: BrowseCall };

const download = (shot: Shot) => void saveImage(shot.src, shot.filename);

/**
 * The screenshots of one run of tool calls, as a single frame under those calls. Supplies what
 * the frame cannot know by itself: where the app serves each image from, and the names of the
 * MCP servers a tool name is read against.
 */
function Shots({ files }: { files: readonly ShotFile[] }) {
  const servers = useMCPServerNames();
  const shots = useMemo(
    () =>
      toShots(
        files.map(({ file, call }) => ({
          file,
          call,
          src: toAbsoluteFilePath(file.filepath ?? '', apiBaseUrl()),
        })),
        servers,
      ),
    [files, servers],
  );
  return <BrowseFrame shots={shots} onDownload={download} />;
}

/** The list is rebuilt whenever the reply around it re-renders; its entries are not. */
export default memo(
  Shots,
  (previous, next) =>
    previous.files.length === next.files.length &&
    previous.files.every(
      (item, index) => item.file === next.files[index].file && item.call === next.files[index].call,
    ),
);

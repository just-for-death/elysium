import { ActionIcon } from "@mantine/core";
import { IconRepeat, IconRepeatOnce } from "@tabler/icons-react";
import { type FC, memo } from "react";

import {
  useAudioElement,
  usePlayerStatus,
  useSetPlayerStatus,
} from "../providers/Player";

interface ButtonRepeatProps {
  iconSize?: number;
}

export const ButtonRepeat: FC<ButtonRepeatProps> = memo(({ iconSize }) => {
  const playerState = usePlayerStatus();
  const getAudioEl = useAudioElement();
  const setPlayerState = useSetPlayerStatus();

  const handleClick = () => {
    const audio = getAudioEl();
    if (!audio) return;
    audio.loop = !playerState.repeat;

    setPlayerState((previousState) => ({
      ...previousState,
      repeat: !previousState.repeat,
    }));
  };

  return (
    <ActionIcon color="transparent" onClick={handleClick} title="Repeat">
      {playerState.repeat ? (
        <IconRepeatOnce size={iconSize ?? undefined} />
      ) : (
        <IconRepeat size={iconSize ?? undefined} />
      )}
    </ActionIcon>
  );
});

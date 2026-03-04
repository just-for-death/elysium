import { ActionIcon, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconUserMinus, IconUserPlus } from "@tabler/icons-react";
import { type FC, memo } from "react";

import {
  addFollowedArtist,
  getFollowedArtists,
  removeFollowedArtist,
  useFollowedArtists,
  useSetFollowedArtists,
} from "../providers/FollowedArtists";
import { AM_ARTIST_PREFIX, isAppleMusicArtistId, getItunesArtistId } from "../services/appleMusic";

interface ButtonFollowArtistProps {
  authorId: string;
  authorName: string;
  thumbnail?: string;
  buttonSize?: number;
  iconSize?: number;
}

export const ButtonFollowArtist: FC<ButtonFollowArtistProps> = memo(
  ({ authorId, authorName, thumbnail = "", buttonSize = 36, iconSize = 16 }) => {
    const followed = useFollowedArtists();
    const setFollowed = useSetFollowedArtists();

    const isFollowing = followed.some((a) => a.artistId === authorId);

    const handleToggle = () => {
      if (isFollowing) {
        removeFollowedArtist(authorId);
        setFollowed(getFollowedArtists());
        notifications.show({
          title: "Unfollowed",
          message: `Stopped following ${authorName}`,
          color: "gray",
        });
      } else {
        const platform = isAppleMusicArtistId(authorId) ? "apple_music" : "youtube";
        const itunesId = platform === "apple_music" ? getItunesArtistId(authorId) : undefined;
        addFollowedArtist({
          artistId: authorId,
          name: authorName,
          thumbnail,
          platform,
          itunesId,
          followedAt: new Date().toISOString(),
        });
        setFollowed(getFollowedArtists());
        notifications.show({
          title: "Following",
          message: `Now following ${authorName} — you'll be notified of new releases`,
          color: "green",
        });
      }
    };

    return (
      <Tooltip
        label={isFollowing ? `Unfollow ${authorName}` : `Follow ${authorName}`}
        position="left"
      >
        <ActionIcon
          variant={isFollowing ? "filled" : "outline"}
          color={isFollowing ? "pink" : "gray"}
          radius="md"
          size={buttonSize}
          onClick={handleToggle}
          aria-label={isFollowing ? "Unfollow artist" : "Follow artist"}
        >
          {isFollowing ? (
            <IconUserMinus size={iconSize} />
          ) : (
            <IconUserPlus size={iconSize} />
          )}
        </ActionIcon>
      </Tooltip>
    );
  },
);

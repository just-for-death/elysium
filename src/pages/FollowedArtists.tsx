import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Card,
  Flex,
  Group,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconMusic, IconUserMinus } from "@tabler/icons-react";
import { memo } from "react";

import { PageHeader } from "../components/PageHeader";
import {
  getFollowedArtists,
  removeFollowedArtist,
  useFollowedArtists,
  useSetFollowedArtists,
  type FollowedArtist,
} from "../providers/FollowedArtists";
import { notifications } from "@mantine/notifications";
import { useStableNavigate } from "../providers/Navigate";

export const FollowedArtistsPage = memo(() => {
  const artists = useFollowedArtists();

  return (
    <div>
      <PageHeader title="Following" />
      {artists.length === 0 ? (
        <EmptyState />
      ) : (
        <Stack gap="sm" p="md">
          {artists.map((artist) => (
            <ArtistRow key={artist.artistId} artist={artist} />
          ))}
        </Stack>
      )}
    </div>
  );
});

const EmptyState = memo(() => (
  <Box p="xl" style={{ textAlign: "center" }}>
    <IconMusic size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
    <Title order={4} c="dimmed">
      No followed artists yet
    </Title>
    <Text size="sm" c="dimmed" mt={8}>
      Follow artists from search results or channel pages to get notified
      when they release new music.
    </Text>
  </Box>
));

const ArtistRow = memo(({ artist }: { artist: FollowedArtist }) => {
  const setFollowed = useSetFollowedArtists();
  const navigate = useStableNavigate();

  const handleUnfollow = () => {
    removeFollowedArtist(artist.artistId);
    setFollowed(getFollowedArtists());
    notifications.show({
      title: "Unfollowed",
      message: `Stopped following ${artist.name}`,
      color: "gray",
    });
  };

  const handleClick = () => {
    // Only navigatable for YouTube artists
    if (artist.platform === "youtube") {
      navigate(`/channels/${artist.artistId}`);
    }
  };

  const followedDate = new Date(artist.followedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const releaseDate = artist.lastSeenReleaseDate
    ? new Date(artist.lastSeenReleaseDate).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <Card withBorder radius="md" p="md">
      <Flex align="center" gap="md">
        <Avatar
          src={artist.thumbnail || undefined}
          size={48}
          radius="xl"
          style={{ cursor: artist.platform === "youtube" ? "pointer" : "default" }}
          onClick={handleClick}
        >
          {artist.name.slice(0, 2).toUpperCase()}
        </Avatar>

        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" align="center" wrap="nowrap">
            <Text
              fw={600}
              lineClamp={1}
              style={{
                cursor: artist.platform === "youtube" ? "pointer" : "default",
              }}
              onClick={handleClick}
            >
              {artist.name}
            </Text>
            <Badge
              size="xs"
              color={artist.platform === "apple_music" ? "pink" : "red"}
              variant="light"
            >
              {artist.platform === "apple_music" ? "Apple Music" : "YouTube"}
            </Badge>
          </Group>

          {artist.lastSeenReleaseName ? (
            <Text size="xs" c="dimmed" lineClamp={1} mt={2}>
              Latest: <strong>{artist.lastSeenReleaseName}</strong>
              {releaseDate ? ` · ${releaseDate}` : ""}
            </Text>
          ) : (
            <Text size="xs" c="dimmed" mt={2}>
              Following since {followedDate}
            </Text>
          )}
        </Box>

        <Tooltip label={`Unfollow ${artist.name}`} position="left">
          <ActionIcon
            variant="subtle"
            color="gray"
            size={32}
            onClick={handleUnfollow}
            aria-label="Unfollow artist"
          >
            <IconUserMinus size={16} />
          </ActionIcon>
        </Tooltip>
      </Flex>
    </Card>
  );
});

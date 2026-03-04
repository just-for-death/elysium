import {
  RouterProvider as RRProvider,
  createBrowserRouter,
} from "react-router-dom";

import { AboutPage } from "../pages/About";
import { ChannelDetailPage } from "../pages/ChannelDetail";
import { DashboardPage } from "../pages/Dashboard";
import { DevicesPage } from "../pages/Devices";
import { FavoritesPage } from "../pages/Favorites";
import { FollowedArtistsPage } from "../pages/FollowedArtists";
import { GenresPage } from "../pages/Genres";
import { HistoryPage } from "../pages/History";
import { PlaylistDetailPage } from "../pages/PlaylistDetail";
import { PlaylistsPage } from "../pages/Playlists";
import { PopularPage } from "../pages/Popular";
import { SearchPage } from "../pages/Search";
import { SettingsPage } from "../pages/Settings";
import { TrendingPage } from "../pages/Trending";
import { App } from "./App";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        element: <DashboardPage />,
        index: true,
      },
      {
        path: "search",
        element: <SearchPage />,
      },
      {
        path: "trending",
        element: <TrendingPage />,
      },
      {
        path: "most-popular",
        element: <PopularPage />,
      },
      {
        path: "favorites",
        element: <FavoritesPage />,
      },
      {
        path: "playlists",
        element: <PlaylistsPage />,
      },
      {
        path: "following",
        element: <FollowedArtistsPage />,
      },
      {
        path: "settings",
        element: <SettingsPage />,
      },
      {
        path: "devices",
        element: <DevicesPage />,
      },
      {
        path: "about",
        element: <AboutPage />,
      },
      {
        path: "genres",
        element: <GenresPage />,
      },
      {
        path: "history",
        element: <HistoryPage />,
      },
      {
        path: "playlists/:playlistId",
        element: <PlaylistDetailPage />,
      },
      {
        path: "channels/:authorId",
        element: <ChannelDetailPage />,
      },
    ],
  },
]);

export const RouterProvider = () => {
  return <RRProvider router={router} />;
};

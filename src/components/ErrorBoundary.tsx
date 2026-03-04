import { Box, Button, Stack, Text, Title } from "@mantine/core";
import { Component, type PropsWithChildren, type ReactNode } from "react";

interface Props {
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<PropsWithChildren<Props>, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[elysium] Error boundary caught:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  handleClearStorage = () => {
    try {
      localStorage.removeItem("db_library");
      window.location.reload();
    } catch {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <Box p="xl" maw={500} mx="auto" mt="xl">
          <Stack gap="md">
            <Title order={2}>Something went wrong</Title>
            <Text size="sm" c="dimmed">
              {this.state.error.message}
            </Text>
            <Text size="sm" c="dimmed">
              If you see a black screen or database errors, try clearing site data below.
            </Text>
            <Button variant="light" onClick={this.handleRetry}>
              Try again
            </Button>
            <Button variant="subtle" color="gray" onClick={this.handleClearStorage}>
              Clear data and reload
            </Button>
          </Stack>
        </Box>
      );
    }
    return this.props.children;
  }
}

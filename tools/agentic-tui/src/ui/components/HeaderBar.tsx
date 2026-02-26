import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme.js";

export function HeaderBar(props: {
  title: string;
  connected: number;
  total: number;
  runtime?: string;
  phase?: string;
  risk?: string;
  account?: string;
  ai?: string;
}): JSX.Element {
  const theme = useTheme();
  const statusColor = props.connected > 0 ? theme.success : theme.warning;
  const riskColor = props.risk === "HIGH" ? theme.error : props.risk === "MEDIUM" ? theme.warning : theme.success;
  return (
    <Box borderStyle="single" borderColor={theme.muted} paddingX={1} flexDirection="column">
      <Box justifyContent="space-between">
        <Text color={theme.accent} bold>{props.title}</Text>
        <Text color={statusColor}>Connected {props.connected}/{props.total}</Text>
      </Box>
      <Box marginTop={1} justifyContent="space-between">
        <Box>
          <Text color={theme.muted}>Runtime </Text>
          <Text color={theme.text}>{props.runtime || "ready"}</Text>
          <Text color={theme.muted}>  </Text>
          <Text color={theme.muted}>Phase </Text>
          <Text color={theme.text}>{props.phase || "INPUT"}</Text>
          <Text color={theme.muted}>  Risk </Text>
          <Text color={riskColor}>{props.risk || "LOW"}</Text>
          <Text color={theme.muted}>  Account </Text>
          <Text color={theme.text}>{props.account || "default"}</Text>
        </Box>
        <Box>
          <Text color={theme.muted}>AI </Text>
          <Text color={theme.text}>{props.ai || "deterministic"}</Text>
        </Box>
      </Box>
    </Box>
  );
}


/*
 * <license header>
 */
 
import React, { useState, useEffect } from 'react'
import { attach } from "@adobe/uix-guest"
import {
  Flex,
  Provider,
  Content,
  defaultTheme,
  Text,
  Button,
  Heading,
  ComboBox,
  Item,
  View,
  Divider,
  Badge
} from '@adobe/react-spectrum'

import {
  extensionId,
  EDS_GITHUB_ORG,
  EDS_GITHUB_REPO,
  RTE_STYLES_CSS_PATH,
  BROADCAST_CHANNEL_NAME,
  EVENT_AUE_UI_SELECT,
  EVENT_AUE_UI_UPDATE,
  EVENT_RTE_TEXT_SELECTION
} from "./Constants";

export default function RTEStylesRail () {
  // Fields
  const [guestConnection, setGuestConnection] = useState();
  const [editorState, setEditorState] = useState(null);
  const [richtextItem, setRichtextItem] = useState({});
  const [textValue, setTextValue] = useState("");
  const [rteStyles, setRteStyles] = useState([]);
  const [selectedStyle, setSelectedStyle] = useState("");
  const [selectedText, setSelectedText] = useState("");

  /**
   * Extract the branch/ref from the editorState location URL.
   */
  const getRefFromEditorState = (state) => {
    try {
      const url = new URL(state.location);
      return url.searchParams.get('ref') || 'main';
    } catch (e) {
      console.error("Error extracting ref from editorState:", e);
      return 'main';
    }
  };

  /**
   * Build the URL for the AIO Runtime action that proxies the CSS fetch.
   */
  const buildActionUrl = (state) => {
    const ref = getRefFromEditorState(state);
    const params = new URLSearchParams({
      ref,
      org: EDS_GITHUB_ORG,
      repo: EDS_GITHUB_REPO,
      path: RTE_STYLES_CSS_PATH,
    });
    return `/api/v1/web/custom-rte-styles/fetch-rte-styles?${params.toString()}`;
  };

  const updateRichtextWithGuest = async (editable) => {
    const target = {
      editable: { id: editable.id }
    };

    const patch = [{
      op: "replace",
      path: "/" + editable.prop,
      value: editable.content
    }]

    await guestConnection.host.editorActions.update( { target, patch });
  }

  /**
   * When author selects a style from the dropdown, wrap the selected text
   * with <span class="styleName">selectedText</span> in the HTML content.
   *
   * If the text is already styled, the existing span is replaced with the new style.
   */
  const handleSelectionChange = async (styleName) => {
    if (!selectedText || !styleName) return;

    setSelectedStyle(styleName);

    let updatedTextValue = textValue;

    if (selectedText && textValue) {
      const escapedSelectedText = selectedText.replaceAll(
        /[.*+?^${}()|[\]\\]/g, String.raw`\$&`
      );

      // Check if text is already wrapped in a styled span — if so, replace the class
      const alreadyStyledPattern = new RegExp(
        String.raw`<span\s+class="[^"]*">` + escapedSelectedText + String.raw`</span>`
      );

      if (alreadyStyledPattern.test(updatedTextValue)) {
        // Replace existing style with new style
        updatedTextValue = updatedTextValue.replace(
          alreadyStyledPattern,
          `<span class="${styleName}">${selectedText}</span>`
        );
      } else {
        // Wrap the first plain occurrence with a styled span
        updatedTextValue = updatedTextValue.replace(
          selectedText,
          `<span class="${styleName}">${selectedText}</span>`
        );
      }

      setTextValue(updatedTextValue);
    }

    const updatedItem = {
      ...richtextItem,
      content: updatedTextValue
    };

    await updateRichtextWithGuest(updatedItem);
    await guestConnection.host.editorActions.refreshPage();

    // Clear selection after applying
    setSelectedText("");
    setSelectedStyle("");
  };

  /**
   * Remove styling from the selected text — unwrap it from its <span>.
   */
  const handleRemoveStyle = async () => {
    if (!selectedText || !textValue) return;

    const escapedSelectedText = selectedText.replaceAll(
      /[.*+?^${}()|[\]\\]/g, String.raw`\$&`
    );

    // Find <span class="anything">selectedText</span> and replace with just selectedText
    const styledPattern = new RegExp(
      String.raw`<span\s+class="[^"]*">` + escapedSelectedText + String.raw`</span>`, 'g'
    );

    const updatedTextValue = textValue.replace(styledPattern, selectedText);
    setTextValue(updatedTextValue);

    const updatedItem = {
      ...richtextItem,
      content: updatedTextValue
    };

    await updateRichtextWithGuest(updatedItem);
    await guestConnection.host.editorActions.refreshPage();

    setSelectedText("");
    setSelectedStyle("");
  };

  /**
   * Check if the selected text already has a style applied.
   * Returns the class name if styled, or empty string if not.
   */
  const getExistingStyle = (content, text) => {
    if (!content || !text) return "";
    const escapedText = text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const pattern = new RegExp(String.raw`<span\s+class="([^"]*)">`+ escapedText + String.raw`</span>`);
    const match = content.match(pattern);
    return match ? match[1] : "";
  };

  const handleShowStyled = async () => {
    const url = new URL(editorState.location);
    url.searchParams.set('wpRTEShowStyled', 'true');
    await guestConnection.host.editorActions.navigateTo(url.toString())
  };

  const handleShowMarked = async () => {
    const url = new URL(editorState.location);
    url.searchParams.set('wpRTEShowStyled', 'false');
    await guestConnection.host.editorActions.navigateTo(url.toString())
  };

  const loadRTEStyles = async (stylesUrl) => {
    try {
      console.log("loadRTEStyles: fetching CSS from action URL:", stylesUrl);
      const response = await fetch(stylesUrl);

      if (!response.ok) {
        console.error("loadRTEStyles: failed to fetch CSS, status:", response.status);
        return [];
      }

      const cssText = await response.text();
      console.log("loadRTEStyles: CSS loaded, length:", cssText.length);

      const classNameRegex = /\.([a-zA-Z0-9_-]+)\s*\{/g;
      const matches = [];
      let match;

      while ((match = classNameRegex.exec(cssText)) !== null) {
        matches.push(match[1]);
      }

      console.log("loadRTEStyles: found styles:", matches);
      setRteStyles(matches);
      return matches;
    } catch (error) {
      console.error("Error loading RTE styles:", error);
      return [];
    }
  };

  /**
   * Given a list of editables and a selected item, resolve to the
   * richtext editable (which may be a child of a custom block).
   */
  const findEditableTarget = (editables, item) => {
    if (item.content || !item.children || item.children.length === 0) {
      return item;
    }
    const child = editables.find((e) => e.id === item.children[0]);
    if (child) {
      child.resource = item.resource;
      return child;
    }
    return item;
  };

  const initExtension = async () => {
    const connection = await attach({ id: extensionId });
    setGuestConnection(connection);

    let state = await connection.host.editorState.get();
    setEditorState(state);

    const actionUrl = buildActionUrl(state);
    console.log("RTEStylesRail: loading RTE styles via action:", actionUrl);
    await loadRTEStyles(actionUrl);

    const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);

    channel.onmessage = async (event) => {
      if (!event.data.type) return;

      if (event.data.type === EVENT_RTE_TEXT_SELECTION) {
        const selection = event.data.data?.selectedText || "";
        console.log("RTEStylesRail: text selection received:", selection);
        setSelectedText(selection.trim());
        return;
      }

      if (event.data.type !== EVENT_AUE_UI_SELECT && event.data.type !== EVENT_AUE_UI_UPDATE) return;

      state = await connection.host.editorState.get();
      setEditorState(state);

      const resource = event.data.type === EVENT_AUE_UI_SELECT
        ? event.data.data.resource
        : event.data.data.request.target.resource;

      const item = state.editables.find((e) => e.resource === resource);
      if (!item) return;

      const target = findEditableTarget(state.editables, item);
      setRichtextItem(target);
      setTextValue(target.content || "");
      setSelectedText("");
      setSelectedStyle("");
    };
  };

  useEffect(() => {
    initExtension().catch(console.error);
  }, []);

  const existingStyle = getExistingStyle(textValue, selectedText);

  return (
    <Provider theme={defaultTheme} colorScheme="dark" height="100vh">
      <Content height="100%">
        <View padding="size-200">
          <Heading marginBottom="size-100" level="3">Selected Text</Heading>
          <View
            backgroundColor="gray-800"
            padding="size-150"
            borderRadius="regular"
            borderWidth="thin"
            borderColor={selectedText ? "blue-400" : "gray-600"}
            minHeight="size-500"
          >
            <Text UNSAFE_style={{ fontStyle: selectedText ? 'normal' : 'italic' }}>
              {selectedText || "Select some text in the editor to style it"}
            </Text>
          </View>

          {existingStyle && (
            <View marginTop="size-100">
              <Badge variant="info">Currently styled: {existingStyle}</Badge>
            </View>
          )}

          <Heading marginTop="size-300" marginBottom="size-100" level="3">Apply Style</Heading>
          <ComboBox
            selectedKey={selectedStyle}
            onSelectionChange={handleSelectionChange}
            width="100%"
            placeholder="Select a style to apply"
            marginTop="size-200"
            isDisabled={!selectedText}
          >
            {rteStyles.map((styleName) => (
              <Item key={styleName}>{styleName}</Item>
            ))}
          </ComboBox>

          {existingStyle && (
            <Button
              variant="negative"
              style="outline"
              onPress={handleRemoveStyle}
              marginTop="size-200"
              width="100%"
              isDisabled={!selectedText}
            >
              Remove Style
            </Button>
          )}

          <Divider size="M" marginTop="size-400" marginBottom="size-200" />

          <Flex direction="row" gap="size-100">
            <Button variant="secondary" onPress={handleShowMarked} flex={1}>Show Marked</Button>
            <Button variant="secondary" onPress={handleShowStyled} flex={1}>Show Styled</Button>
          </Flex>
        </View>
      </Content>
    </Provider>
  );
}

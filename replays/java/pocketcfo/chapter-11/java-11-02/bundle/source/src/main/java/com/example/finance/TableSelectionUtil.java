package com.example.finance;

import javafx.scene.Node;
import javafx.scene.Parent;
import javafx.scene.control.TableView;
import javafx.scene.input.MouseEvent;

/**
 * Clears a table's selection on any click outside a given container, so a
 * user editing a selected row can get back to "add new" mode just by
 * clicking away instead of being stuck once something is selected.
 */
final class TableSelectionUtil {

    private TableSelectionUtil() {
    }

    static void clearSelectionOnClickOutside(Parent container, TableView<?> table) {
        container.sceneProperty().addListener((obs, oldScene, newScene) -> {
            if (newScene != null) {
                newScene.addEventFilter(MouseEvent.MOUSE_PRESSED, event -> {
                    if (!isWithin(container, event.getTarget())) {
                        table.getSelectionModel().clearSelection();
                    }
                });
            }
        });
    }

    private static boolean isWithin(Node container, Object target) {
        if (!(target instanceof Node)) {
            return false;
        }
        Node current = (Node) target;
        while (current != null) {
            if (current == container) {
                return true;
            }
            current = current.getParent();
        }
        return false;
    }
}

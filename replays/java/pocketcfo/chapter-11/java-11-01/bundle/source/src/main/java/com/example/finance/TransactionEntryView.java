package com.example.finance;

import javafx.beans.property.SimpleObjectProperty;
import javafx.beans.property.SimpleStringProperty;
import javafx.collections.FXCollections;
import javafx.collections.ObservableList;
import javafx.geometry.Insets;
import javafx.scene.control.Button;
import javafx.scene.control.ComboBox;
import javafx.scene.control.DatePicker;
import javafx.scene.control.Label;
import javafx.scene.control.Separator;
import javafx.scene.control.Tab;
import javafx.scene.control.TableColumn;
import javafx.scene.control.TableView;
import javafx.scene.control.TextField;
import javafx.scene.layout.HBox;
import javafx.scene.layout.VBox;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.Comparator;

/**
 * Category creation + transaction entry and the current month's transaction
 * list. A category has to exist before a transaction can reference it, so
 * this view owns a small category-creation form rather than a separate view.
 */
public class TransactionEntryView {

    private final CategoryRepository categoryRepository;
    private final TransactionRepository transactionRepository;

    private final ObservableList<Category> categoryOptions = FXCollections.observableArrayList();
    private final ObservableList<Transaction> monthTransactions = FXCollections.observableArrayList();

    public TransactionEntryView(CategoryRepository categoryRepository, TransactionRepository transactionRepository) {
        this.categoryRepository = categoryRepository;
        this.transactionRepository = transactionRepository;
        categoryOptions.setAll(categoryRepository.findAll());
        refreshTransactions();
    }

    public Tab asTab() {
        Tab tab = new Tab("Transactions", buildContent());
        tab.setClosable(false);
        return tab;
    }

    private VBox buildContent() {
        VBox root = new VBox(12, buildCategoryForm(), new Separator(), buildTransactionForm(), buildTransactionTable());
        root.setPadding(new Insets(12));
        return root;
    }

    private HBox buildCategoryForm() {
        TextField nameField = new TextField();
        nameField.setPromptText("Category name");
        TextField targetField = new TextField();
        targetField.setPromptText("Monthly target");
        Button addButton = new Button("Add category");
        Label status = new Label();

        addButton.setOnAction(e -> {
            String name = nameField.getText().trim();
            if (name.isEmpty()) {
                status.setText("Category name is required.");
                return;
            }
            try {
                BigDecimal monthlyTarget = new BigDecimal(targetField.getText().trim());
                categoryRepository.add(new Category(name, monthlyTarget));
                categoryOptions.setAll(categoryRepository.findAll());
                nameField.clear();
                targetField.clear();
                status.setText("Added category \"" + name + "\".");
            } catch (NumberFormatException ex) {
                status.setText("Monthly target must be a number.");
            }
        });

        return new HBox(8, new Label("New category:"), nameField, targetField, addButton, status);
    }

    private VBox buildTransactionForm() {
        DatePicker datePicker = new DatePicker(LocalDate.now());
        ComboBox<TransactionType> typeBox = new ComboBox<>(FXCollections.observableArrayList(TransactionType.values()));
        typeBox.setValue(TransactionType.EXPENSE);
        ComboBox<Category> categoryBox = new ComboBox<>(categoryOptions);
        TextField amountField = new TextField();
        amountField.setPromptText("Amount");
        TextField descriptionField = new TextField();
        descriptionField.setPromptText("Description");
        Button addButton = new Button("Add transaction");
        Label status = new Label();

        addButton.setOnAction(e -> {
            LocalDate date = datePicker.getValue();
            TransactionType type = typeBox.getValue();
            Category category = categoryBox.getValue();
            if (date == null || type == null || category == null) {
                status.setText("Date, type, and category are required.");
                return;
            }
            try {
                BigDecimal amount = new BigDecimal(amountField.getText().trim());
                String description = descriptionField.getText().trim();
                transactionRepository.add(date, type, category.getName(), amount, description);
                refreshTransactions();
                amountField.clear();
                descriptionField.clear();
                status.setText("Added transaction.");
            } catch (NumberFormatException ex) {
                status.setText("Amount must be a number.");
            }
        });

        HBox row = new HBox(8, new Label("New transaction:"), datePicker, typeBox, categoryBox,
                amountField, descriptionField, addButton, status);
        return new VBox(row);
    }

    private TableView<Transaction> buildTransactionTable() {
        TableView<Transaction> table = new TableView<>(monthTransactions);

        TableColumn<Transaction, LocalDate> dateCol = new TableColumn<>("Date");
        dateCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getDate()));

        TableColumn<Transaction, TransactionType> typeCol = new TableColumn<>("Type");
        typeCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getType()));

        TableColumn<Transaction, String> categoryCol = new TableColumn<>("Category");
        categoryCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getCategoryName()));

        TableColumn<Transaction, BigDecimal> amountCol = new TableColumn<>("Amount");
        amountCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getAmount()));

        TableColumn<Transaction, String> descriptionCol = new TableColumn<>("Description");
        descriptionCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getDescription()));

        table.getColumns().addAll(dateCol, typeCol, categoryCol, amountCol, descriptionCol);
        return table;
    }

    private void refreshTransactions() {
        YearMonth currentMonth = YearMonth.now();
        monthTransactions.setAll(transactionRepository.findAll().stream()
                .filter(t -> YearMonth.from(t.getDate()).equals(currentMonth))
                .sorted(Comparator.comparing(Transaction::getDate))
                .toList());
    }
}

package com.example.finance;

/**
 * Editing/deleting a category touches more than the category list: renaming
 * has to cascade into anything that references the old name by string, and
 * deleting has to be blocked while something still depends on it.
 */
public class CategoryService {

    private final CategoryRepository categoryRepository;
    private final TransactionRepository transactionRepository;
    private final RecurringObligationRepository recurringObligationRepository;
    private final SavingsGoalRepository savingsGoalRepository;

    public CategoryService(CategoryRepository categoryRepository, TransactionRepository transactionRepository,
                            RecurringObligationRepository recurringObligationRepository,
                            SavingsGoalRepository savingsGoalRepository) {
        this.categoryRepository = categoryRepository;
        this.transactionRepository = transactionRepository;
        this.recurringObligationRepository = recurringObligationRepository;
        this.savingsGoalRepository = savingsGoalRepository;
    }

    public void update(String originalName, Category updated) {
        categoryRepository.update(originalName, updated);
        if (!originalName.equals(updated.getName())) {
            transactionRepository.renameCategory(originalName, updated.getName());
        }
    }

    public void delete(String name) {
        boolean inUse = transactionRepository.findAll().stream().anyMatch(t -> t.getCategoryName().equals(name))
                || recurringObligationRepository.findAll().stream().anyMatch(o -> o.getName().equals(name))
                || savingsGoalRepository.findAll().stream().anyMatch(g -> g.getName().equals(name));
        if (inUse) {
            throw new IllegalStateException(
                    "Can't delete \"" + name + "\" — it still has transactions, obligations, or a savings goal.");
        }
        categoryRepository.remove(name);
    }
}

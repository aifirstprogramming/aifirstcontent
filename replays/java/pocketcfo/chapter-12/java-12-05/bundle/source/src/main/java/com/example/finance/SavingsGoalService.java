package com.example.finance;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;

/**
 * Goal progress, and allocating a month's leftover to a goal. Allocations
 * are gated against "leftover minus what's already been allocated this
 * month" so the same leftover can't be assigned twice.
 */
public class SavingsGoalService {

    private final SavingsGoalRepository savingsGoalRepository;
    private final GoalContributionRepository goalContributionRepository;
    private final BudgetService budgetService;
    private final CategoryRepository categoryRepository;

    public SavingsGoalService(SavingsGoalRepository savingsGoalRepository,
                               GoalContributionRepository goalContributionRepository,
                               BudgetService budgetService,
                               CategoryRepository categoryRepository) {
        this.savingsGoalRepository = savingsGoalRepository;
        this.goalContributionRepository = goalContributionRepository;
        this.budgetService = budgetService;
        this.categoryRepository = categoryRepository;
    }

    public void addGoal(SavingsGoal goal) {
        validateCategoryExists(goal.getCategoryName());
        savingsGoalRepository.add(goal);
    }

    /**
     * Updates a goal's target amount/date/assigned category, and — if the
     * name changed — cascades the rename to its contribution history so
     * past progress isn't silently orphaned.
     */
    public void updateGoal(String originalName, SavingsGoal updated) {
        validateCategoryExists(updated.getCategoryName());
        savingsGoalRepository.update(originalName, updated);
        if (!originalName.equals(updated.getName())) {
            goalContributionRepository.renameGoal(originalName, updated.getName());
        }
    }

    private void validateCategoryExists(String categoryName) {
        boolean exists = categoryRepository.findAll().stream().anyMatch(c -> c.getName().equals(categoryName));
        if (!exists) {
            throw new IllegalArgumentException("No such category: \"" + categoryName + "\".");
        }
    }

    /**
     * Refuses to delete a goal that already has money saved toward it,
     * since that history would otherwise vanish silently.
     */
    public void deleteGoal(String name) {
        BigDecimal saved = totalSaved(name);
        if (saved.signum() > 0) {
            throw new IllegalStateException(
                    "Can't delete \"" + name + "\" — it already has " + saved + " saved. Rename it instead.");
        }
        savingsGoalRepository.remove(name);
    }

    public List<GoalProgress> goalProgress() {
        List<GoalProgress> progress = new ArrayList<>();
        for (SavingsGoal goal : savingsGoalRepository.findAll()) {
            progress.add(new GoalProgress(goal, totalSaved(goal.getName())));
        }
        return progress;
    }

    public BigDecimal totalSaved(String goalName) {
        return goalContributionRepository.findAll().stream()
                .filter(c -> c.getGoalName().equals(goalName))
                .map(GoalContribution::getAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    public BigDecimal totalContributions(YearMonth month) {
        return goalContributionRepository.findAll().stream()
                .filter(c -> YearMonth.from(c.getDate()).equals(month))
                .map(GoalContribution::getAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    public BigDecimal availableLeftover(YearMonth month) {
        return budgetService.leftover(month).subtract(totalContributions(month));
    }

    public void allocateLeftoverToGoal(String goalName, BigDecimal amount, YearMonth month) {
        if (amount == null || amount.signum() <= 0) {
            throw new IllegalArgumentException("Allocation amount must be positive.");
        }
        if (amount.compareTo(availableLeftover(month)) > 0) {
            throw new IllegalArgumentException("Allocation exceeds available leftover.");
        }
        goalContributionRepository.add(dateWithinMonth(month), goalName, amount);
    }

    /**
     * Updates an existing allocation. Validated the same way as a new one,
     * except the allocation's own current amount is added back to the
     * available leftover first (if it was counted in this month at all) so
     * editing it isn't blocked by the allocation it's replacing.
     */
    public void updateContribution(long id, LocalDate date, String goalName, BigDecimal amount, YearMonth month) {
        GoalContribution existing = findContribution(id);
        if (amount == null || amount.signum() <= 0) {
            throw new IllegalArgumentException("Allocation amount must be positive.");
        }
        BigDecimal availableExcludingThis = availableLeftover(month);
        if (YearMonth.from(existing.getDate()).equals(month)) {
            availableExcludingThis = availableExcludingThis.add(existing.getAmount());
        }
        if (amount.compareTo(availableExcludingThis) > 0) {
            throw new IllegalArgumentException("Allocation exceeds available leftover.");
        }
        goalContributionRepository.update(id, date, goalName, amount);
    }

    public void deleteContribution(long id) {
        goalContributionRepository.remove(id);
    }

    private GoalContribution findContribution(long id) {
        return goalContributionRepository.findAll().stream()
                .filter(c -> c.getId() == id)
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("No such allocation."));
    }

    /**
     * Today's date if it falls within the given month, else the 1st of that
     * month — so allocating into a past/future month (not "now") doesn't
     * silently record a contribution date outside the month it's meant to
     * count toward.
     */
    private LocalDate dateWithinMonth(YearMonth month) {
        LocalDate today = LocalDate.now();
        return YearMonth.from(today).equals(month) ? today : month.atDay(1);
    }

    public static class GoalProgress {
        private final SavingsGoal goal;
        private final BigDecimal savedAmount;

        public GoalProgress(SavingsGoal goal, BigDecimal savedAmount) {
            this.goal = goal;
            this.savedAmount = savedAmount;
        }

        public SavingsGoal getGoal() {
            return goal;
        }

        public BigDecimal getSavedAmount() {
            return savedAmount;
        }

        public double getPercentComplete() {
            BigDecimal target = goal.getTargetAmount();
            if (target.signum() <= 0) {
                return 0.0;
            }
            return savedAmount.divide(target, 4, RoundingMode.HALF_UP).doubleValue();
        }
    }
}

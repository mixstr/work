<?php

namespace app\entities;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
#[ORM\Table(name: "coefficient")]
class CoefficientEntity
{
    #[ORM\Id]
    #[ORM\Column(type: 'integer')]
    private ?int $id = null;

    #[ORM\Column(type: 'integer')]
    private ?int $employee_id = null;

    #[ORM\Column(type: 'integer')]
    private ?int $month_id = null;

    #[ORM\Column(type: 'float')]
    private ?float $coefficient = null;

    public function getId(): int
    {
        return $this->id;
    }

    public function setId(?int $newId): void
    {
        $this->id = $newId;
    }

    public function getEmployee(): string
    {
        return $this->employee_id;
    }

    public function setEmployee(?int $newEmployeeId): void
    {
        $this->employee_id = $newEmployeeId;
    }

    public function getMonth(): string
    {
        return $this->month_id;
    }

    public function setMonth(?int $newMonthId): void
    {
        $this->month_id = $newMonthId;
    }

    public function getCoefficient(): float
    {
        return $this->coefficient;
    }
    
    public function setCoefficient(?float $newCoefficient): void
    {
        $this->coefficient = $newCoefficient;
    }
}
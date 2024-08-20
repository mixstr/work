<?php

namespace app\entities;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
#[ORM\Table(name: "employees")]
class EmployeeEntity
{
    #[ORM\Id]
    #[ORM\GeneratedValue(strategy: "AUTO")]
    #[ORM\Column(type: 'integer')]
    private ?int $id = null;

    #[ORM\Column(type: 'string')]
    private ?string $fio = null;

    #[ORM\Column(type: 'date')]
    private ?int $hire_date = null;

    #[ORM\Column(type: 'date')]
    private ?int $termination_date = null;

    public function getId(): ?int
    {
        return $this->id;
    }

    public function getFio(): ?string
    {
        return $this->fio;
    }

    public function setFio(?string $fio)
    {
        $this->fio = $fio;
    }

    public function getHireDate() 
    {
        return $this->hire_date;
    }

    public function setHireDate($hire_date)
    {
        $this->hire_date = $hire_date;
    }

    public function getTerminationDate()
    {
        return $this->termination_date;
    }
    
    public function setTerminationDate($termination_date)
    {
        $this->termination_date = $termination_date;
    }
}
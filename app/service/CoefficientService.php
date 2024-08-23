<?php

namespace app\service;

use Doctrine\ORM\EntityManager;
use app\entities\CoefficientEntity;

class CoefficientService
{
    public EntityManager $entityManager;
    public array $coefficients;

    public function __construct()
    {
        require_once "bootstrap.php";
        $this->entityManager = callEntityManager();
    }

    public function selectAll()
    {
        $coefficients = $this->entityManager->getRepository('app\entities\CoefficientEntity')->findAll();
        echo ("selectAll method executed");
        print_r ($coefficients);
    }

    public function selectById($id)
    {
        $coefficients = $this->entityManager->find('app\entities\CoefficientEntity', $id);
        echo ("selectById method executed");
        print_r ($coefficients);
    }

    public function selectByEmployee($employee_id)
    {
        $coefficients = $this->entityManager->getRepository('app\entities\CoefficientEntity')->findBy(array('employee_id' => $employee_id));
        echo ("selectByEmployee method executed");
        print_r ($coefficients);
    }

    public function selectByMonth($month_id)
    {
        $coefficients = $this->entityManager->getRepository('app\entities\CoefficientEntity')->findBy(array('month_id' => $month_id));
        echo ("selectByMonth method executed");
        print_r ($coefficients);
    }

    public function insert($id, $employee_id, $month_id, $coefficient)
    {
        $coefficientEntity = new CoefficientEntity();

        $coefficientEntity->setId($id);
        $coefficientEntity->setEmployee($employee_id);
        $coefficientEntity->setMonth($month_id);

        foreach ($coefficient as $value) {
            $coefficientEntity->setCoefficient($value);
        }

        $this->entityManager->persist($coefficientEntity);
        $this->entityManager->flush();

        print_r ("Insert method executed") . ($coefficientEntity);
    }

    public function update($id, $employee_id, $month_id, $coefficient)
    {
        $coefficientEntity = $this->entityManager->find('app\entities\CoefficientEntity', $id);
        foreach ($employee_id as $value) {
            $coefficientEntity->setEmployee($value);
        }
        
        foreach ($month_id as $value) {
            $coefficientEntity->setMonth($value);
        }
    
        foreach ($coefficient as $value) {
            $coefficientEntity->setCoefficient($value);
        }

        $this->entityManager->flush();
        echo ("Update method executed");
        print_r ($coefficientEntity);
    }
    public function delete($id)
    {
        $coefficientEntity = $this->entityManager->find('app\entities\CoefficientEntity', $id);
        $this->entityManager->remove($coefficientEntity);
        $this->entityManager->flush();

        print_r ("Delete method executed") . ($coefficientEntity);
    }
}



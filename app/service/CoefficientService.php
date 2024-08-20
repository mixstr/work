<?php

namespace app\service;

use app\dto\CoefficientDto;
use Doctrine\DBAL\DriverManager;
use Doctrine\ORM\EntityManager;
use Doctrine\ORM\ORMSetup;

class CoefficientService
{
    public EntityManager $entityManager;
    public array $coefficients;

    public function __construct()
    {
        require_once "bootstrap.php";
        $this->$entityManager = callEntityManager();
    }

    public function selectAll()
    {
        $coefficients = $this->$entityManager->getRepository('app\entities\CoefficientEntity')->findAll();
        print_r($coefficients);
    }

    public function selectById($id)
    {
        $coefficients = $this->$entityManager->find('app\entities\CoefficientEntity', $id);
        print_r($coefficients);
    }

    public function selectByEmployee($employee_id)
    {
        $coefficients = $this->$entityManager->find('app\entities\CoefficientEntity', $employee_id);
        print_r($coefficients);
    }

    public function selectByMonth($month)
    {
        $coefficients = $this->$entityManager->find('app\entities\CoefficientEntity', $month);
        print_r($coefficients);
    }
}



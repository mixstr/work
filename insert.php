<?php
    global $databasehandler;
    require 'configDB.php';
    $sql = 'INSERT INTO employees(id, fio, hire_date, termination_date) VALUES(:id, :fio, :hire_date, :termination_date)';
    $query = $databasehandler->prepare($sql);
    $query->execute(['id'=> 12, 'fio'=> "Жирков Юрий Валентинович", 'hire_date'=>"15.06.1999", 'termination_date'=>"20.06.2020"]);
    ?>